// Native messaging host for the "XUI Browser Client" Firefox extension.
//
// Firefox talks to this program over stdin/stdout (native messaging protocol:
// 4-byte native-endian length + UTF-8 JSON). The host is stateless: Firefox
// starts a new process for every request. The tunnel itself is a detached
// xray-core process (VLESS/VMess/Trojan/Shadowsocks -> local SOCKS5), tracked
// through run/state.json.
//
// Works on macOS, Windows and Linux; OS-specific process handling lives in
// proc_unix.go / proc_windows.go. No third-party dependencies.
package main

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
)

const hostVersion = "0.1.0"

// coreName is the executable name of the tunnel core (without ".exe").
const coreName = "xray"

// hostError is an error whose text is shown to the user as is.
type hostError struct{ msg string }

func (e hostError) Error() string { return e.msg }

func userErr(format string, a ...any) error { return hostError{fmt.Sprintf(format, a...)} }

// ------------------------------------------------------------------ paths

type layout struct {
	Base, Profiles, Run, Logs, HostJSON, State, RunConf, LogFile string
}

var P layout

func dataDir() string {
	if d := os.Getenv("XUI_BROWSER_HOME"); d != "" { // tests / portable installs
		return d
	}
	home, _ := os.UserHomeDir()
	switch runtime.GOOS {
	case "darwin":
		return filepath.Join(home, "Library", "Application Support", "XUI-Browser")
	case "windows":
		if d := os.Getenv("LOCALAPPDATA"); d != "" {
			return filepath.Join(d, "XUI-Browser")
		}
		return filepath.Join(home, "AppData", "Local", "XUI-Browser")
	default:
		if d := os.Getenv("XDG_CONFIG_HOME"); d != "" {
			return filepath.Join(d, "xui-browser")
		}
		return filepath.Join(home, ".config", "xui-browser")
	}
}

func initPaths() {
	b := dataDir()
	P = layout{
		Base:     b,
		Profiles: filepath.Join(b, "profiles"),
		Run:      filepath.Join(b, "run"),
		Logs:     filepath.Join(b, "logs"),
		HostJSON: filepath.Join(b, "host.json"),
		State:    filepath.Join(b, "run", "state.json"),
		RunConf:  filepath.Join(b, "run", "config.json"),
		LogFile:  filepath.Join(b, "logs", "xray.log"),
	}
}

func ensureDirs() error {
	for _, d := range []string{P.Base, P.Profiles, P.Run, P.Logs} {
		if err := os.MkdirAll(d, 0o700); err != nil {
			return err
		}
	}
	return nil
}

// writePrivate writes a file readable only by the current user (on Windows the
// per-user LOCALAPPDATA ACL already restricts access).
func writePrivate(path string, data []byte) error {
	// A unique temp name: Firefox runs one host process per message, several may write at once.
	f, err := os.CreateTemp(filepath.Dir(path), filepath.Base(path)+".*.tmp")
	if err != nil {
		return err
	}
	tmp := f.Name()
	_, err = f.Write(data)
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Chmod(tmp, 0o600)
	}
	if err == nil {
		err = os.Rename(tmp, path)
	}
	if err != nil {
		os.Remove(tmp)
	}
	return err
}

func loadJSON(path string, v any) bool {
	data, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	return json.Unmarshal(data, v) == nil
}

func exeName(name string) string {
	if runtime.GOOS == "windows" {
		return name + ".exe"
	}
	return name
}

func corePath() (string, error) {
	var hs struct {
		Xray string `json:"xray"`
	}
	loadJSON(P.HostJSON, &hs)
	path := hs.Xray
	if path == "" {
		path = filepath.Join(P.Base, "bin", exeName(coreName))
	}
	if st, err := os.Stat(path); err != nil || st.IsDir() {
		return "", userErr("Не найден xray-core (%s). Запустите установщик помощника.", path)
	}
	return path, nil
}

// ------------------------------------------------------------------ profiles

var idRe = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)
var slugRe = regexp.MustCompile(`[^a-z0-9_-]+`)

var translit = strings.NewReplacer(
	"а", "a", "б", "b", "в", "v", "г", "g", "д", "d", "е", "e", "ё", "e", "ж", "zh", "з", "z", "и", "i",
	"й", "y", "к", "k", "л", "l", "м", "m", "н", "n", "о", "o", "п", "p", "р", "r", "с", "s", "т", "t",
	"у", "u", "ф", "f", "х", "h", "ц", "ts", "ч", "ch", "ш", "sh", "щ", "sch", "ъ", "", "ы", "y", "ь", "",
	"э", "e", "ю", "yu", "я", "ya",
)

func slugify(name string) string {
	s := slugRe.ReplaceAllString(translit.Replace(strings.ToLower(name)), "-")
	s = strings.Trim(s, "-_")
	if len(s) > 40 {
		s = strings.Trim(s[:40], "-_")
	}
	if s == "" {
		return "server"
	}
	return s
}

func profilePath(id string) (string, error) {
	if !idRe.MatchString(id) {
		return "", userErr("Некорректный идентификатор сервера.")
	}
	return filepath.Join(P.Profiles, id+".json"), nil
}

// stored is the on-disk profile: the share link itself (it holds the secret,
// file mode 600); the Xray outbound is rebuilt from it on every start.
type stored struct {
	Name string `json:"name"`
	Link string `json:"link"`
	Sub  string `json:"sub,omitempty"` // subscription URL the server came from
}

// profile is what the extension sees (no secrets).
type profile struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Protocol  string `json:"protocol,omitempty"`
	Endpoint  string `json:"endpoint,omitempty"`
	Transport string `json:"transport,omitempty"`
	Sub       string `json:"sub,omitempty"`
	Error     string `json:"error,omitempty"`
}

func loadStored(id string) (stored, error) {
	path, err := profilePath(id)
	if err != nil {
		return stored{}, err
	}
	var st stored
	if !loadJSON(path, &st) || st.Link == "" {
		return stored{}, userErr("Сервер не найден.")
	}
	return st, nil
}

func describe(id string, st stored) profile {
	p := profile{ID: id, Name: st.Name, Sub: st.Sub}
	s, err := parseLink(st.Link)
	if err != nil {
		p.Error = err.Error()
		return p
	}
	p.Protocol, p.Endpoint, p.Transport = s.Protocol, s.endpoint(), s.Transport
	return p
}

func profileIDs() ([]string, error) {
	entries, err := os.ReadDir(P.Profiles)
	if err != nil {
		return nil, err
	}
	var ids []string
	for _, e := range entries {
		if id, ok := strings.CutSuffix(e.Name(), ".json"); ok && idRe.MatchString(id) {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	return ids, nil
}

func listProfiles() ([]profile, error) {
	ids, err := profileIDs()
	if err != nil {
		return nil, err
	}
	out := []profile{}
	for _, id := range ids {
		st, err := loadStored(id)
		if err != nil {
			out = append(out, profile{ID: id, Name: id, Error: err.Error()})
			continue
		}
		out = append(out, describe(id, st))
	}
	return out, nil
}

func trimName(name string) string {
	name = strings.TrimSpace(name)
	if r := []rune(name); len(r) > 80 {
		name = string(r[:80])
	}
	return name
}

// addServer validates one share link and stores it as a new profile.
func addServer(name, link, sub string) (profile, error) {
	s, err := parseLink(link)
	if err != nil {
		return profile{}, err
	}
	if name = trimName(name); name == "" {
		name = trimName(s.Name)
	}
	if name == "" {
		name = s.Address
	}
	if err := configtest(s); err != nil {
		return profile{}, err
	}
	base := slugify(name)
	id := base
	var path string
	for n := 2; ; n++ {
		if path, err = profilePath(id); err != nil {
			return profile{}, err
		}
		// O_EXCL reserves the id: two imports running at once cannot take the same one.
		f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if err == nil {
			f.Close()
			break
		}
		if !errors.Is(err, os.ErrExist) {
			return profile{}, err
		}
		id = fmt.Sprintf("%s-%d", base, n)
	}
	st := stored{Name: name, Link: strings.TrimSpace(link), Sub: sub}
	data, _ := json.Marshal(st)
	if err := writePrivate(path, data); err != nil {
		os.Remove(path)
		return profile{}, err
	}
	return describe(id, st), nil
}

type importResult struct {
	Profiles []profile `json:"profiles"`
	Errors   []string  `json:"errors"`
	Removed  []string  `json:"removed"`
}

// importText accepts share links (one per line), a base64 list of them, or a
// subscription URL (https://…), and adds every server it finds.
func importText(name, text string) (importResult, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return importResult{}, userErr("Вставьте ссылку сервера или адрес подписки.")
	}
	if isURL(text) && len(strings.Fields(text)) == 1 {
		return syncSubscription(text)
	}
	links := extractLinks(text)
	if len(links) == 0 {
		return importResult{}, userErr("Не найдено ссылок vless://, vmess://, trojan://, ss:// или адреса подписки https://…")
	}
	if len(links) > 1 {
		name = "" // a name typed in the form only fits a single server
	}
	res := importResult{Profiles: []profile{}, Errors: []string{}, Removed: []string{}}
	for _, l := range links {
		p, err := addServer(name, l, "")
		if err != nil {
			if len(links) == 1 {
				return res, err
			}
			res.Errors = append(res.Errors, err.Error())
			continue
		}
		res.Profiles = append(res.Profiles, p)
	}
	if len(res.Profiles) == 0 {
		return res, userErr("Ни один сервер не добавлен: %s", res.Errors[0])
	}
	return res, nil
}

// syncSubscription downloads a subscription and makes the stored servers of
// that subscription match it: unchanged links keep their profile (and id),
// vanished ones are removed, new ones are added.
func syncSubscription(subURL string) (importResult, error) {
	links, err := fetchSubscription(subURL)
	if err != nil {
		return importResult{}, err
	}
	res := importResult{Profiles: []profile{}, Errors: []string{}, Removed: []string{}}
	want := map[string]bool{}
	for _, l := range links {
		want[l] = true
	}
	ids, err := profileIDs()
	if err != nil {
		return res, err
	}
	have := map[string]bool{}
	for _, id := range ids {
		st, err := loadStored(id)
		if err != nil || st.Sub != subURL {
			continue
		}
		if want[st.Link] && !have[st.Link] {
			have[st.Link] = true
			res.Profiles = append(res.Profiles, describe(id, st))
		} else if err := deleteProfile(id); err == nil {
			res.Removed = append(res.Removed, id)
		}
	}
	for _, l := range links {
		if have[l] {
			continue
		}
		have[l] = true
		p, err := addServer("", l, subURL)
		if err != nil {
			res.Errors = append(res.Errors, err.Error())
			continue
		}
		res.Profiles = append(res.Profiles, p)
	}
	if len(res.Profiles) == 0 {
		msg := "в подписке нет подходящих серверов"
		if len(res.Errors) > 0 {
			msg = res.Errors[0]
		}
		return res, userErr("Ни один сервер подписки не добавлен: %s", msg)
	}
	return res, nil
}

func deleteProfile(id string) error {
	path, err := profilePath(id)
	if err != nil {
		return err
	}
	var st tunnelState
	if loadJSON(P.State, &st) && st.Profile == id && coreAlive(st.PID) {
		if err := stopTunnel(); err != nil {
			return err
		}
	}
	os.Remove(path)
	return nil
}

func renameProfile(id, name string) error {
	st, err := loadStored(id)
	if err != nil {
		return err
	}
	if st.Name = trimName(name); st.Name == "" {
		return userErr("Пустое название.")
	}
	path, _ := profilePath(id)
	data, _ := json.Marshal(st)
	return writePrivate(path, data)
}

// ------------------------------------------------------------------ tunnel

type tunnelState struct {
	PID       int    `json:"pid"`
	Profile   string `json:"profile"`
	Port      int    `json:"port"`
	InfoPort  int    `json:"infoPort"`
	Username  string `json:"username"`
	Password  string `json:"password"`
	StartedAt int64  `json:"startedAt"`
}

func portOpen(port int, timeout time.Duration) bool {
	c, err := net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)), timeout)
	if err != nil {
		return false
	}
	c.Close()
	return true
}

// coreError picks the meaningful line of Xray's output ("Failed to start: …").
func coreError(out string) string {
	lines := strings.Split(strings.TrimSpace(strings.ReplaceAll(out, "\r\n", "\n")), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if l := strings.TrimSpace(lines[i]); strings.Contains(l, "ailed") || strings.Contains(l, "rror") {
			return l
		}
	}
	return strings.TrimSpace(lines[len(lines)-1])
}

// configtest asks xray to validate the config built for a server ("run -test").
func configtest(s server) error {
	bin, err := corePath()
	if err != nil {
		return nil // not installed yet: skip validation
	}
	conf, err := xrayConfig(s, 40800, 40801, "test", "test")
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(P.Run, "configtest.*.json")
	if err != nil {
		return err
	}
	tmp := f.Name()
	f.Close()
	defer os.Remove(tmp)
	if err := writePrivate(tmp, conf); err != nil {
		return err
	}
	cmd := exec.Command(bin, "run", "-test", "-c", tmp)
	hideWindow(cmd)
	out, err := cmd.CombinedOutput()
	if err != nil {
		msg := coreError(string(out))
		if msg == "" {
			msg = err.Error()
		}
		return userErr("xray отклонил конфигурацию сервера: %s", msg)
	}
	return nil
}

// stopTunnel stops the tracked xray. The state file is removed only when the
// process is really gone: otherwise the tunnel would become untrackable and keep
// the ports busy forever.
func stopTunnel() error {
	var st tunnelState
	if loadJSON(P.State, &st) && coreAlive(st.PID) {
		terminate(st.PID)
		if coreAlive(st.PID) {
			return userErr("Не удалось остановить xray (pid %d). Завершите процесс вручную.", st.PID)
		}
	}
	os.Remove(P.State)
	os.Remove(P.RunConf) // holds the server secret and the SOCKS password
	return nil
}

func trimLog() {
	const limit, keep = 2 << 20, 256 << 10
	st, err := os.Stat(P.LogFile)
	if err != nil || st.Size() <= limit {
		return
	}
	data, err := os.ReadFile(P.LogFile)
	if err != nil {
		return
	}
	data = data[len(data)-keep:]
	if i := bytes.IndexByte(data, '\n'); i >= 0 {
		data = data[i+1:]
	}
	writePrivate(P.LogFile, data)
}

func randomPassword() string {
	b := make([]byte, 18)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func startTunnel(id string, port, infoPort int) (map[string]any, error) {
	bin, err := corePath()
	if err != nil {
		return nil, err
	}
	sp, err := loadStored(id)
	if err != nil {
		return nil, err
	}
	srv, err := parseLink(sp.Link)
	if err != nil {
		return nil, err
	}
	if port < 1024 || port > 65535 || infoPort < 1024 || infoPort > 65535 || port == infoPort {
		return nil, userErr("Некорректные порты.")
	}

	var st tunnelState
	if loadJSON(P.State, &st) && coreAlive(st.PID) && st.Profile == id && st.Port == port && st.InfoPort == infoPort && portOpen(port, 300*time.Millisecond) {
		return publicState(st), nil // already running with the same settings
	}
	if err := stopTunnel(); err != nil {
		return nil, err
	}
	for _, p := range []int{port, infoPort} {
		if portOpen(p, 300*time.Millisecond) {
			return nil, userErr("Порт 127.0.0.1:%d уже занят другой программой.", p)
		}
	}

	st = tunnelState{Profile: id, Port: port, InfoPort: infoPort, Username: "xui", Password: randomPassword()}
	conf, err := xrayConfig(srv, port, infoPort, st.Username, st.Password)
	if err != nil {
		return nil, err
	}
	if err := writePrivate(P.RunConf, conf); err != nil {
		return nil, err
	}
	trimLog()
	logf, err := os.OpenFile(P.LogFile, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, err
	}
	fmt.Fprintf(logf, "\n==== %s start server=%s port=%d\n", time.Now().Format("2006-01-02 15:04:05"), id, port)

	newCmd := func() *exec.Cmd {
		c := exec.Command(bin, "run", "-c", P.RunConf)
		c.Stdout, c.Stderr = logf, logf
		return c
	}
	cmd, note, err := startDetached(newCmd)
	if note != "" {
		fmt.Fprintln(logf, "xui_host:", note)
	}
	logf.Close()
	if err != nil {
		return nil, userErr("Не удалось запустить xray: %v", err)
	}
	exited := make(chan struct{})
	go func() { cmd.Wait(); close(exited) }()

	deadline := time.Now().Add(8 * time.Second)
	for !portOpen(port, 300*time.Millisecond) {
		select {
		case <-exited:
			return nil, userErr("xray завершился при запуске: %s", coreError(tailLog(8)))
		default:
		}
		if time.Now().After(deadline) {
			cmd.Process.Kill()
			return nil, userErr("xray не открыл SOCKS-порт за 8 секунд.")
		}
		time.Sleep(150 * time.Millisecond)
	}
	st.PID = cmd.Process.Pid
	st.StartedAt = time.Now().Unix()
	data, _ := json.Marshal(st)
	if err := writePrivate(P.State, data); err != nil {
		return nil, err
	}
	return publicState(st), nil
}

// metrics reads the traffic counters of the "proxy" outbound from Xray's stats API
// ("xray api statsquery" prints JSON). Empty when the API does not answer.
func metrics(infoPort int) map[string]any {
	out := map[string]any{}
	bin, err := corePath()
	if err != nil {
		return out
	}
	cmd := exec.Command(bin, "api", "statsquery", "--server=127.0.0.1:"+strconv.Itoa(infoPort))
	hideWindow(cmd)
	done := make(chan []byte, 1)
	go func() { b, _ := cmd.Output(); done <- b }()
	var raw []byte
	select {
	case raw = <-done:
	case <-time.After(4 * time.Second):
		if cmd.Process != nil {
			cmd.Process.Kill()
		}
		return out
	}
	var res struct {
		Stat []struct {
			Name  string `json:"name"`
			Value any    `json:"value"`
		} `json:"stat"`
	}
	if json.Unmarshal(raw, &res) != nil {
		return out
	}
	for _, s := range res.Stat {
		var n int64
		switch v := s.Value.(type) {
		case float64:
			n = int64(v)
		case string:
			n, _ = strconv.ParseInt(v, 10, 64)
		}
		switch s.Name {
		case "outbound>>>proxy>>>traffic>>>downlink":
			out["rx"] = n
		case "outbound>>>proxy>>>traffic>>>uplink":
			out["tx"] = n
		}
	}
	return out
}

func publicState(st tunnelState) map[string]any {
	if !coreAlive(st.PID) {
		return map[string]any{"running": false}
	}
	return map[string]any{
		"running": true, "profile": st.Profile, "port": st.Port, "infoPort": st.InfoPort, "username": st.Username,
		"password": st.Password, "startedAt": st.StartedAt, "pid": st.PID, "metrics": metrics(st.InfoPort),
	}
}

func tailLog(lines int) string {
	f, err := os.Open(P.LogFile)
	if err != nil {
		return ""
	}
	defer f.Close()
	if st, err := f.Stat(); err == nil && st.Size() > 64*1024 {
		f.Seek(st.Size()-64*1024, io.SeekStart)
	}
	data, _ := io.ReadAll(f)
	all := strings.Split(strings.TrimRight(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n"), "\n")
	if len(all) > lines {
		all = all[len(all)-lines:]
	}
	return strings.Join(all, "\n")
}

func coreVersion() any {
	bin, err := corePath()
	if err != nil {
		return nil
	}
	cmd := exec.Command(bin, "version")
	hideWindow(cmd)
	out, _ := cmd.CombinedOutput()
	if s := strings.TrimSpace(strings.SplitN(string(out), "\n", 2)[0]); s != "" {
		return s
	}
	return nil
}

// ------------------------------------------------------------------ dispatch

func str(m map[string]any, k string) string {
	s, _ := m[k].(string)
	return s
}

func num(m map[string]any, k string, def int) int {
	switch v := m[k].(type) {
	case float64:
		return int(v)
	case string:
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func handle(msg map[string]any) (map[string]any, error) {
	switch cmd := str(msg, "cmd"); cmd {
	case "ping":
		return map[string]any{"version": hostVersion, "xray": coreVersion(), "dataDir": P.Base, "os": runtime.GOOS}, nil
	case "list":
		ps, err := listProfiles()
		return map[string]any{"profiles": ps}, err
	case "import":
		res, err := importText(str(msg, "name"), str(msg, "text"))
		return map[string]any{"added": res.Profiles, "errors": res.Errors, "removed": res.Removed}, err
	case "delete":
		return map[string]any{}, deleteProfile(str(msg, "id"))
	case "rename":
		return map[string]any{}, renameProfile(str(msg, "id"), str(msg, "name"))
	case "start":
		st, err := startTunnel(str(msg, "id"), num(msg, "port", 40810), num(msg, "infoPort", 40811))
		return map[string]any{"state": st}, err
	case "stop":
		return map[string]any{}, stopTunnel()
	case "status":
		var st tunnelState
		loadJSON(P.State, &st)
		return map[string]any{"state": publicState(st)}, nil
	case "logs":
		return map[string]any{"log": tailLog(num(msg, "lines", 80))}, nil
	default:
		return nil, userErr("Неизвестная команда: %q", cmd)
	}
}

func readMessage(r io.Reader) (map[string]any, error) {
	var n uint32
	if err := binary.Read(r, binary.NativeEndian, &n); err != nil {
		return nil, err
	}
	if n > 16<<20 {
		return nil, errors.New("message too large")
	}
	buf := make([]byte, n)
	if _, err := io.ReadFull(r, buf); err != nil {
		return nil, err
	}
	var m map[string]any
	if err := json.Unmarshal(buf, &m); err != nil {
		return map[string]any{}, nil // reported as unknown command
	}
	return m, nil
}

func writeMessage(w io.Writer, v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	if err := binary.Write(w, binary.NativeEndian, uint32(len(data))); err != nil {
		return err
	}
	_, err = w.Write(data)
	return err
}

func safeHandle(msg map[string]any) (res map[string]any) {
	defer func() {
		if r := recover(); r != nil {
			res = map[string]any{"ok": false, "error": fmt.Sprintf("внутренняя ошибка: %v", r)}
		}
	}()
	out, err := handle(msg)
	if err != nil {
		var he hostError
		if errors.As(err, &he) {
			return map[string]any{"ok": false, "error": he.msg}
		}
		return map[string]any{"ok": false, "error": err.Error()}
	}
	if out == nil {
		out = map[string]any{}
	}
	out["ok"] = true
	return out
}

func main() {
	initPaths()
	if len(os.Args) > 1 {
		// Command-line helpers for the installers; Firefox always runs the host
		// with the manifest path / extension id as arguments, never these flags.
		switch os.Args[1] {
		case "--version":
			fmt.Println("xui_host", hostVersion, runtime.GOOS+"/"+runtime.GOARCH)
			return
		case "--self-test":
			ensureDirs()
			res := safeHandle(map[string]any{"cmd": "ping"})
			out, _ := json.Marshal(res)
			fmt.Println(string(out))
			if res["ok"] != true || res["xray"] == nil {
				os.Exit(1)
			}
			return
		case "--stop":
			if err := stopTunnel(); err != nil {
				fmt.Fprintln(os.Stderr, err)
				os.Exit(1)
			}
			return
		}
	}
	if err := ensureDirs(); err != nil {
		writeMessage(os.Stdout, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	in := bufio.NewReader(os.Stdin)
	for {
		msg, err := readMessage(in)
		if err != nil {
			return // stdin closed by Firefox
		}
		if writeMessage(os.Stdout, safeHandle(msg)) != nil {
			return
		}
	}
}
