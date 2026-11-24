package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

const (
	vlessReality = "vless://11111111-2222-3333-4444-555555555555@203.0.113.7:443?type=tcp&security=reality&pbk=PUBKEY&fp=firefox&sni=example.com&sid=ab12&spx=%2F&flow=xtls-rprx-vision#%D0%9D%D0%B8%D0%B4%D0%B5%D1%80%D0%BB%D0%B0%D0%BD%D0%B4%D1%8B"
	vlessWS      = "vless://11111111-2222-3333-4444-555555555555@cdn.example.com:8443?type=ws&security=tls&path=%2Fws%3Fed%3D2048&host=cdn.example.com&alpn=h2%2Chttp%2F1.1#WS"
	trojanGRPC   = "trojan://p%40ss@t.example.com:443?type=grpc&serviceName=svc&mode=multi&sni=t.example.com#Trojan"
)

func setup(t *testing.T) {
	t.Helper()
	t.Setenv("XUI_BROWSER_HOME", t.TempDir())
	initPaths()
	if err := ensureDirs(); err != nil {
		t.Fatal(err)
	}
}

func vmessLink(m map[string]any) string {
	b, _ := json.Marshal(m)
	return "vmess://" + base64.StdEncoding.EncodeToString(b)
}

// dig walks nested maps / slices: dig(x, "settings", "vnext", 0, "port").
func dig(v any, path ...any) any {
	for _, p := range path {
		switch k := p.(type) {
		case string:
			m, _ := v.(map[string]any)
			v = m[k]
		case int:
			a, _ := v.([]any)
			if k >= len(a) {
				return nil
			}
			v = a[k]
		}
	}
	return v
}

func TestParseVless(t *testing.T) {
	s, err := parseLink(vlessReality)
	if err != nil {
		t.Fatal(err)
	}
	if s.Protocol != "vless" || s.Name != "Нидерланды" || s.endpoint() != "203.0.113.7:443" || s.Transport != "tcp + reality" {
		t.Fatalf("server: %+v", s)
	}
	o := s.Outbound
	if dig(o, "settings", "vnext", 0, "users", 0, "flow") != "xtls-rprx-vision" ||
		dig(o, "settings", "vnext", 0, "users", 0, "encryption") != "none" ||
		dig(o, "streamSettings", "realitySettings", "publicKey") != "PUBKEY" ||
		dig(o, "streamSettings", "realitySettings", "shortId") != "ab12" ||
		dig(o, "streamSettings", "realitySettings", "spiderX") != "/" ||
		dig(o, "streamSettings", "realitySettings", "fingerprint") != "firefox" ||
		dig(o, "streamSettings", "security") != "reality" {
		t.Fatalf("outbound: %+v", o)
	}

	s, err = parseLink(vlessWS)
	if err != nil {
		t.Fatal(err)
	}
	ss := s.Outbound["streamSettings"]
	if dig(ss, "wsSettings", "path") != "/ws?ed=2048" || dig(ss, "wsSettings", "host") != "cdn.example.com" ||
		dig(ss, "tlsSettings", "serverName") != "cdn.example.com" || len(dig(ss, "tlsSettings", "alpn").([]string)) != 2 {
		t.Fatalf("ws: %+v", ss)
	}
	for _, bad := range []string{"vless://@h:1", "vless://id@host", "vless://id@h:443?security=reality", "vless://id@h:443?type=quic", "http://x"} {
		if _, err := parseLink(bad); err == nil {
			t.Errorf("accepted %q", bad)
		}
	}
}

func TestParseTrojanVmessSS(t *testing.T) {
	s, err := parseLink(trojanGRPC)
	if err != nil {
		t.Fatal(err)
	}
	if dig(s.Outbound, "settings", "servers", 0, "password") != "p@ss" || s.Transport != "grpc + tls" ||
		dig(s.Outbound, "streamSettings", "grpcSettings", "serviceName") != "svc" ||
		dig(s.Outbound, "streamSettings", "grpcSettings", "multiMode") != true {
		t.Fatalf("trojan: %+v", s)
	}

	s, err = parseLink(vmessLink(map[string]any{"v": "2", "ps": "VM", "add": "v.example.com", "port": "8080", "id": "uuid-1",
		"aid": 0, "scy": "auto", "net": "ws", "type": "none", "host": "v.example.com", "path": "/p", "tls": "tls"}))
	if err != nil {
		t.Fatal(err)
	}
	if s.Name != "VM" || s.Port != 8080 || dig(s.Outbound, "settings", "vnext", 0, "users", 0, "id") != "uuid-1" ||
		dig(s.Outbound, "streamSettings", "wsSettings", "path") != "/p" || dig(s.Outbound, "streamSettings", "tlsSettings", "serverName") != "v.example.com" {
		t.Fatalf("vmess: %+v", s)
	}
	if _, err := parseLink("vmess://!!!"); err == nil {
		t.Fatal("bad vmess accepted")
	}

	cred := base64.RawURLEncoding.EncodeToString([]byte("aes-256-gcm:secret:x"))
	legacy := base64.StdEncoding.EncodeToString([]byte("chacha20-ietf-poly1305:pw@d@198.51.100.9:8388"))
	for link, want := range map[string][3]string{
		"ss://" + cred + "@198.51.100.9:8388#SS%20one":                              {"aes-256-gcm", "secret:x", "SS one"},
		"ss://" + legacy + "#old":                                                   {"chacha20-ietf-poly1305", "pw@d", "old"},
		"ss://2022-blake3-aes-128-gcm:a%2Bb%3D:c%2Fd@198.51.100.9:8388?type=tcp#22": {"2022-blake3-aes-128-gcm", "a+b=:c/d", "22"},
	} {
		s, err := parseLink(link)
		if err != nil {
			t.Fatalf("%s: %v", link, err)
		}
		srv := dig(s.Outbound, "settings", "servers", 0)
		if dig(srv, "method") != want[0] || dig(srv, "password") != want[1] || s.Name != want[2] || s.endpoint() != "198.51.100.9:8388" {
			t.Fatalf("ss %s: %+v name=%q", link, srv, s.Name)
		}
	}
}

func TestExtractLinksAndConfig(t *testing.T) {
	plain := vlessReality + "\n\n# comment\n" + trojanGRPC + "\r\n"
	if got := extractLinks(plain); len(got) != 2 {
		t.Fatalf("plain: %v", got)
	}
	if got := extractLinks(base64.StdEncoding.EncodeToString([]byte(plain))); len(got) != 2 || got[1] != trojanGRPC {
		t.Fatalf("base64: %v", got)
	}
	s, _ := parseLink(vlessReality)
	data, err := xrayConfig(s, 40810, 40811, "xui", "pw")
	if err != nil {
		t.Fatal(err)
	}
	var cfg map[string]any
	if json.Unmarshal(data, &cfg) != nil {
		t.Fatal("config is not JSON")
	}
	if dig(cfg, "inbounds", 0, "listen") != "127.0.0.1" || dig(cfg, "inbounds", 0, "settings", "auth") != "password" ||
		dig(cfg, "inbounds", 0, "settings", "accounts", 0, "pass") != "pw" || dig(cfg, "inbounds", 1, "listen") != "127.0.0.1" ||
		dig(cfg, "outbounds", 0, "tag") != "proxy" || dig(cfg, "outbounds", 0, "protocol") != "vless" {
		t.Fatalf("config: %s", data)
	}
}

func TestSlugify(t *testing.T) {
	for in, want := range map[string]string{"Нидерланды #1": "niderlandy-1", "🇳🇱 NL": "nl", "!!!": "server"} {
		if got := slugify(in); got != want {
			t.Errorf("slugify(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestProfilesLifecycle(t *testing.T) {
	setup(t)
	res, err := importText("Тест NL", vlessReality)
	if err != nil || len(res.Profiles) != 1 || res.Profiles[0].ID != "test-nl" || res.Profiles[0].Protocol != "vless" {
		t.Fatalf("import: %+v %v", res, err)
	}
	res, err = importText("ignored", vlessWS+"\n"+trojanGRPC+"\nvless://broken")
	if err != nil || len(res.Profiles) != 2 || len(res.Errors) != 1 || res.Profiles[0].Name != "WS" {
		t.Fatalf("multi import: %+v %v", res, err)
	}
	if _, err := importText("", "just text"); err == nil {
		t.Fatal("garbage accepted")
	}
	if st, _ := os.Stat(filepath.Join(P.Profiles, "test-nl.json")); st.Mode().Perm()&0o077 != 0 && os.PathSeparator == '/' {
		t.Fatalf("profile is readable by others: %v", st.Mode())
	}
	if err := renameProfile("test-nl", "Амстердам"); err != nil {
		t.Fatal(err)
	}
	if err := deleteProfile("../etc"); err == nil {
		t.Fatal("path traversal accepted")
	}
	deleteProfile("trojan")
	list, _ := listProfiles()
	if len(list) != 2 || list[0].Name != "Амстердам" || list[0].Endpoint != "203.0.113.7:443" {
		t.Fatalf("list: %+v", list)
	}
	raw, _ := json.Marshal(list)
	if strings.Contains(string(raw), "11111111") || strings.Contains(string(raw), "PUBKEY") {
		t.Fatalf("profile list leaks secrets: %s", raw)
	}
	if _, err := startTunnel("test-nl", 40810, 40811); err == nil || !strings.Contains(err.Error(), "xray") {
		t.Fatalf("start without xray: %v", err)
	}
}

func TestSubscription(t *testing.T) {
	setup(t)
	body := vlessReality + "\n" + vlessWS
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/json" {
			w.Write([]byte(`[{"outbounds":[]}]`))
			return
		}
		w.Write([]byte(base64.StdEncoding.EncodeToString([]byte(body))))
	}))
	defer srv.Close()
	url := srv.URL + "/sub/abc"

	res, err := importText("", url)
	if err != nil || len(res.Profiles) != 2 || res.Profiles[0].Sub != url {
		t.Fatalf("subscription: %+v %v", res, err)
	}
	keep := res.Profiles[1].ID // the WS server stays
	importText("", trojanGRPC) // a manual server must survive the refresh

	body = vlessWS + "\n" + trojanGRPC
	res, err = importText("", url)
	if err != nil || len(res.Profiles) != 2 || len(res.Removed) != 1 || res.Removed[0] != "niderlandy" {
		t.Fatalf("refresh: %+v %v", res, err)
	}
	if res.Profiles[0].ID != keep {
		t.Fatalf("unchanged server got a new id: %+v", res.Profiles)
	}
	list, _ := listProfiles()
	if len(list) != 3 {
		t.Fatalf("after refresh: %+v", list)
	}
	if _, err := importText("", srv.URL+"/json"); err == nil || !strings.Contains(err.Error(), "JSON") {
		t.Fatalf("json subscription: %v", err)
	}
}

func freePort(t *testing.T) int {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}

// TestTunnelWithFakeXray runs import/start/status/stop against a fake xray binary.
func TestTunnelWithFakeXray(t *testing.T) {
	setup(t)
	bin := filepath.Join(P.Base, "bin", exeName(coreName))
	if out, err := exec.Command("go", "build", "-o", bin, "./testdata/fakexray").CombinedOutput(); err != nil {
		t.Fatalf("build fake: %v\n%s", err, out)
	}
	if v := coreVersion(); v != "Xray 0.0.0 (fake) test" {
		t.Fatalf("version: %v", v)
	}
	if _, err := importText("bad", strings.Replace(vlessWS, "cdn.example.com:8443", "bad.example:8443", 1)); err == nil || !strings.Contains(err.Error(), "bad server") {
		t.Fatalf("configtest should reject: %v", err)
	}
	res, err := importText("NL", vlessReality)
	if err != nil {
		t.Fatal(err)
	}
	id := res.Profiles[0].ID
	port, info := freePort(t), freePort(t)
	st, err := startTunnel(id, port, info)
	if err != nil {
		t.Fatalf("start: %v\nlog:\n%s", err, tailLog(20))
	}
	defer stopTunnel()
	if st["running"] != true || st["password"] == "" || st["port"] != port {
		t.Fatalf("state: %+v", st)
	}
	m := st["metrics"].(map[string]any)
	if m["rx"] != int64(1000) || m["tx"] != int64(200) {
		t.Fatalf("metrics: %+v", m)
	}
	if fi, err := os.Stat(P.RunConf); err != nil || (fi.Mode().Perm()&0o077 != 0 && os.PathSeparator == '/') {
		t.Fatalf("run config: %v %v", fi, err)
	}
	again, err := startTunnel(id, port, info)
	if err != nil || again["pid"] != st["pid"] {
		t.Fatalf("restart with same settings should reuse: %v %+v", err, again)
	}
	st2, err := startTunnel(id, port, freePort(t))
	if err != nil || st2["pid"] == st["pid"] {
		t.Fatalf("info port change ignored: %v", err)
	}
	res2 := safeHandle(map[string]any{"cmd": "status"})
	if res2["ok"] != true || res2["state"].(map[string]any)["running"] != true {
		t.Fatalf("status: %+v", res2)
	}
	if err := deleteProfile(id); err != nil { // deleting the running server stops the tunnel
		t.Fatal(err)
	}
	if coreAlive(st2["pid"].(int)) {
		t.Fatal("xray still alive after delete")
	}
	if _, err := os.Stat(P.RunConf); err == nil {
		t.Fatal("run config with secrets left behind")
	}
	if res := safeHandle(map[string]any{"cmd": "status"}); res["state"].(map[string]any)["running"] != false {
		t.Fatalf("status after stop: %+v", res)
	}
}

func TestProtocolFraming(t *testing.T) {
	var buf bytes.Buffer
	writeMessage(&buf, map[string]any{"cmd": "ping"})
	msg, err := readMessage(&buf)
	if err != nil || msg["cmd"] != "ping" {
		t.Fatalf("roundtrip: %v %v", msg, err)
	}
	if res := safeHandle(map[string]any{"cmd": "nope"}); res["ok"] != false {
		t.Fatal("unknown command accepted")
	}
}
