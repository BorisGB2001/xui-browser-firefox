// Share links of 3x-ui / Xray (vless://, vmess://, trojan://, ss://) and
// subscriptions -> Xray outbound objects.
package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// server is one parsed share link.
type server struct {
	Protocol  string // vless, vmess, trojan, shadowsocks
	Name      string
	Address   string
	Port      int
	Transport string // "ws + tls", "tcp + reality", …
	Outbound  map[string]any
}

func (s server) endpoint() string { return net.JoinHostPort(s.Address, strconv.Itoa(s.Port)) }

var linkSchemes = []string{"vless://", "vmess://", "trojan://", "ss://"}

func isLink(s string) bool {
	for _, p := range linkSchemes {
		if strings.HasPrefix(s, p) {
			return true
		}
	}
	return false
}

func isURL(s string) bool { return strings.HasPrefix(s, "https://") || strings.HasPrefix(s, "http://") }

// b64 decodes standard or URL-safe base64, with or without padding.
func b64(s string) ([]byte, bool) {
	s = strings.TrimRight(strings.Join(strings.Fields(s), ""), "=")
	if s == "" {
		return nil, false
	}
	if out, err := base64.RawURLEncoding.DecodeString(s); err == nil {
		return out, true
	}
	if out, err := base64.RawStdEncoding.DecodeString(s); err == nil {
		return out, true
	}
	return nil, false
}

func splitList(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func validPort(p int) bool { return p >= 1 && p <= 65535 }

// streamSettings builds Xray "streamSettings" from share-link parameters
// (the names are the same in vless:// / trojan:// queries; vmess JSON is mapped to them).
func streamSettings(q map[string]string, address string) (map[string]any, string, error) {
	network := strings.ToLower(q["type"])
	switch network {
	case "", "raw":
		network = "tcp"
	case "splithttp":
		network = "xhttp"
	case "http":
		network = "h2"
	}
	ss := map[string]any{"network": network}
	host, path := q["host"], q["path"]

	switch network {
	case "tcp":
		if q["headerType"] == "http" {
			req := map[string]any{}
			if path != "" {
				req["path"] = splitList(path)
			}
			if host != "" {
				req["headers"] = map[string]any{"Host": splitList(host)}
			}
			ss["tcpSettings"] = map[string]any{"header": map[string]any{"type": "http", "request": req}}
		}
	case "ws":
		ws := map[string]any{"path": orDefault(path, "/")}
		if host != "" {
			ws["host"] = host
		}
		ss["wsSettings"] = ws
	case "httpupgrade":
		hu := map[string]any{"path": orDefault(path, "/")}
		if host != "" {
			hu["host"] = host
		}
		ss["httpupgradeSettings"] = hu
	case "grpc":
		g := map[string]any{"serviceName": q["serviceName"], "multiMode": q["mode"] == "multi"}
		if q["authority"] != "" {
			g["authority"] = q["authority"]
		}
		ss["grpcSettings"] = g
	case "xhttp":
		x := map[string]any{"path": orDefault(path, "/")}
		if host != "" {
			x["host"] = host
		}
		if q["mode"] != "" {
			x["mode"] = q["mode"]
		}
		if q["extra"] != "" {
			var extra map[string]any
			if json.Unmarshal([]byte(q["extra"]), &extra) != nil {
				return nil, "", userErr("Параметр extra (XHTTP) — не JSON.")
			}
			x["extra"] = extra
		}
		ss["xhttpSettings"] = x
	case "kcp":
		k := map[string]any{"header": map[string]any{"type": orDefault(q["headerType"], "none")}}
		if q["seed"] != "" {
			k["seed"] = q["seed"]
		}
		ss["kcpSettings"] = k
	case "h2":
		h := map[string]any{"path": orDefault(path, "/")}
		if host != "" {
			h["host"] = splitList(host)
		}
		ss["httpSettings"] = h
	default:
		return nil, "", userErr("Неизвестный транспорт: %s", network)
	}

	security := strings.ToLower(q["security"])
	switch security {
	case "", "none":
		security = "none"
	case "tls":
		t := map[string]any{}
		sni := q["sni"]
		if sni == "" && host != "" && net.ParseIP(host) == nil && !strings.Contains(host, ",") {
			sni = host
		}
		if sni != "" {
			t["serverName"] = sni
		}
		if q["fp"] != "" {
			t["fingerprint"] = q["fp"]
		}
		if alpn := splitList(q["alpn"]); len(alpn) > 0 {
			t["alpn"] = alpn
		}
		if v := q["allowInsecure"]; v == "1" || v == "true" {
			t["allowInsecure"] = true
		}
		ss["tlsSettings"] = t
	case "reality":
		if q["pbk"] == "" {
			return nil, "", userErr("В ссылке Reality нет открытого ключа (pbk).")
		}
		r := map[string]any{
			"serverName":  q["sni"],
			"fingerprint": orDefault(q["fp"], "chrome"),
			"publicKey":   q["pbk"],
			"shortId":     q["sid"],
		}
		if q["spx"] != "" {
			r["spiderX"] = q["spx"]
		}
		if q["pqv"] != "" {
			r["mldsa65Verify"] = q["pqv"]
		}
		ss["realitySettings"] = r
	default:
		return nil, "", userErr("Неизвестный тип защиты: %s", security)
	}
	ss["security"] = security

	label := network
	if security != "none" {
		label += " + " + security
	}
	return ss, label, nil
}

func orDefault(s, def string) string {
	if s == "" {
		return def
	}
	return s
}

func queryMap(v url.Values) map[string]string {
	m := map[string]string{}
	for k, vals := range v {
		if len(vals) > 0 {
			m[k] = vals[0]
		}
	}
	return m
}

func parseLink(link string) (server, error) {
	link = strings.TrimSpace(link)
	switch {
	case strings.HasPrefix(link, "vmess://"):
		return parseVmess(link)
	case strings.HasPrefix(link, "vless://"), strings.HasPrefix(link, "trojan://"):
		return parseStandard(link)
	case strings.HasPrefix(link, "ss://"):
		return parseShadowsocks(link)
	}
	return server{}, userErr("Неизвестный формат ссылки. Поддерживаются vless://, vmess://, trojan://, ss:// и адрес подписки https://…")
}

func hostPort(u *url.URL) (string, int, error) {
	port, _ := strconv.Atoi(u.Port())
	if u.Hostname() == "" || !validPort(port) {
		return "", 0, userErr("В ссылке нет адреса сервера или порта.")
	}
	return u.Hostname(), port, nil
}

func linkName(u *url.URL, fallback string) string {
	if u.Fragment != "" {
		return u.Fragment
	}
	return fallback
}

// parseStandard handles vless:// and trojan:// (secret@host:port?params#name).
func parseStandard(link string) (server, error) {
	u, err := url.Parse(link)
	if err != nil || u.User == nil {
		return server{}, userErr("Не удалось разобрать ссылку %s://", strings.SplitN(link, ":", 2)[0])
	}
	addr, port, err := hostPort(u)
	if err != nil {
		return server{}, err
	}
	secret := u.User.Username()
	if secret == "" {
		return server{}, userErr("В ссылке нет идентификатора (UUID) или пароля.")
	}
	q := queryMap(u.Query())
	if u.Scheme == "trojan" && q["security"] == "" {
		q["security"] = "tls" // Trojan is TLS unless the link says otherwise
	}
	ss, label, err := streamSettings(q, addr)
	if err != nil {
		return server{}, err
	}
	s := server{Protocol: u.Scheme, Name: linkName(u, addr), Address: addr, Port: port, Transport: label}
	if u.Scheme == "vless" {
		user := map[string]any{"id": secret, "encryption": orDefault(q["encryption"], "none")}
		if q["flow"] != "" {
			user["flow"] = q["flow"]
		}
		s.Outbound = map[string]any{"protocol": "vless", "streamSettings": ss, "settings": map[string]any{
			"vnext": []any{map[string]any{"address": addr, "port": port, "users": []any{user}}}}}
	} else {
		s.Outbound = map[string]any{"protocol": "trojan", "streamSettings": ss, "settings": map[string]any{
			"servers": []any{map[string]any{"address": addr, "port": port, "password": secret}}}}
	}
	return s, nil
}

// jsonStr reads a string or number field of the vmess JSON as a string.
func jsonStr(m map[string]any, k string) string {
	switch v := m[k].(type) {
	case string:
		return strings.TrimSpace(v)
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case bool:
		if v {
			return "1"
		}
	}
	return ""
}

func parseVmess(link string) (server, error) {
	raw, ok := b64(strings.TrimPrefix(link, "vmess://"))
	var m map[string]any
	if !ok || json.Unmarshal(raw, &m) != nil {
		return server{}, userErr("vmess:// должен содержать JSON в base64.")
	}
	addr := jsonStr(m, "add")
	port, _ := strconv.Atoi(jsonStr(m, "port"))
	id := jsonStr(m, "id")
	if addr == "" || !validPort(port) || id == "" {
		return server{}, userErr("В vmess:// нет адреса, порта или идентификатора.")
	}
	q := map[string]string{
		"type": jsonStr(m, "net"), "host": jsonStr(m, "host"), "path": jsonStr(m, "path"),
		"security": jsonStr(m, "tls"), "sni": jsonStr(m, "sni"), "alpn": jsonStr(m, "alpn"),
		"fp": jsonStr(m, "fp"), "allowInsecure": jsonStr(m, "allowInsecure"),
	}
	switch q["type"] {
	case "grpc":
		q["serviceName"], q["mode"], q["path"] = q["path"], jsonStr(m, "type"), ""
		q["authority"], q["host"] = q["host"], ""
	case "kcp":
		q["headerType"], q["seed"] = jsonStr(m, "type"), q["path"]
	case "xhttp", "splithttp":
		q["mode"] = jsonStr(m, "type")
	default:
		q["headerType"] = jsonStr(m, "type")
	}
	ss, label, err := streamSettings(q, addr)
	if err != nil {
		return server{}, err
	}
	aid, _ := strconv.Atoi(jsonStr(m, "aid"))
	user := map[string]any{"id": id, "alterId": aid, "security": orDefault(jsonStr(m, "scy"), "auto")}
	return server{
		Protocol: "vmess", Name: orDefault(jsonStr(m, "ps"), addr), Address: addr, Port: port, Transport: label,
		Outbound: map[string]any{"protocol": "vmess", "streamSettings": ss, "settings": map[string]any{
			"vnext": []any{map[string]any{"address": addr, "port": port, "users": []any{user}}}}},
	}, nil
}

// parseShadowsocks handles SIP002 (ss://base64(method:password)@host:port?…#name,
// userinfo may also be plain percent-encoded) and the legacy all-in-base64 form.
func parseShadowsocks(link string) (server, error) {
	body, frag, _ := strings.Cut(strings.TrimPrefix(link, "ss://"), "#")
	if !strings.Contains(body, "@") {
		main, query, _ := strings.Cut(body, "?")
		raw, ok := b64(main)
		if !ok {
			return server{}, userErr("Не удалось разобрать ss://")
		}
		// method:password@host:port — escape the userinfo before URL parsing
		cred, hp, found := cutLast(string(raw), "@")
		if !found {
			return server{}, userErr("Не удалось разобрать ss://")
		}
		body = url.PathEscape(cred) + "@" + hp
		if query != "" {
			body += "?" + query
		}
	}
	u, err := url.Parse("ss://" + body + "#" + frag)
	if err != nil || u.User == nil {
		return server{}, userErr("Не удалось разобрать ss://")
	}
	addr, port, err := hostPort(u)
	if err != nil {
		return server{}, err
	}
	cred := u.User.String()
	if dec, err := url.PathUnescape(cred); err == nil {
		cred = dec
	}
	if raw, ok := b64(cred); ok && strings.Contains(string(raw), ":") && isPrintable(raw) {
		cred = string(raw)
	}
	method, password, ok := strings.Cut(cred, ":")
	if !ok || method == "" || password == "" {
		return server{}, userErr("В ss:// нет метода шифрования или пароля.")
	}
	q := queryMap(u.Query())
	ss, label, err := streamSettings(q, addr)
	if err != nil {
		return server{}, err
	}
	name := addr
	if frag != "" {
		if dec, err := url.PathUnescape(frag); err == nil {
			name = dec
		} else {
			name = frag
		}
	}
	return server{
		Protocol: "shadowsocks", Name: name, Address: addr, Port: port, Transport: label + " · " + method,
		Outbound: map[string]any{"protocol": "shadowsocks", "streamSettings": ss, "settings": map[string]any{
			"servers": []any{map[string]any{"address": addr, "port": port, "method": method, "password": password}}}},
	}, nil
}

func cutLast(s, sep string) (string, string, bool) {
	i := strings.LastIndex(s, sep)
	if i < 0 {
		return s, "", false
	}
	return s[:i], s[i+len(sep):], true
}

func isPrintable(b []byte) bool {
	for _, c := range b {
		if c < 0x20 || c == 0x7f {
			return false
		}
	}
	return true
}

// extractLinks returns the share links found in text: one per line, or a
// base64-encoded list (the usual subscription body).
func extractLinks(text string) []string {
	text = strings.TrimSpace(text)
	if !strings.Contains(text, "://") {
		if raw, ok := b64(text); ok {
			text = string(raw)
		}
	}
	var out []string
	for _, line := range strings.Fields(text) {
		if isLink(line) {
			out = append(out, line)
		}
	}
	return out
}

// fetchSubscription downloads a subscription and returns its share links.
// The request goes directly, not through the tunnel.
func fetchSubscription(rawURL string) ([]string, error) {
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return nil, userErr("Некорректный адрес подписки.")
	}
	req, _ := http.NewRequest("GET", u.String(), nil)
	req.Header.Set("User-Agent", "xui-browser/"+hostVersion)
	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return nil, userErr("Не удалось загрузить подписку: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, userErr("Сервер подписки ответил %d.", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, userErr("Не удалось прочитать подписку: %v", err)
	}
	links := extractLinks(string(body))
	if len(links) == 0 {
		hint := ""
		if t := strings.TrimSpace(string(body)); strings.HasPrefix(t, "{") || strings.HasPrefix(t, "[") {
			hint = " Похоже, это JSON-подписка — нужен обычный адрес подписки (ссылки в base64)."
		}
		return nil, userErr("В подписке нет ссылок vless/vmess/trojan/ss.%s", hint)
	}
	return links, nil
}

// xrayConfig builds the full client config: SOCKS5 in (password protected),
// the server out, and the stats API on infoPort.
func xrayConfig(s server, port, infoPort int, user, pass string) ([]byte, error) {
	out := map[string]any{"tag": "proxy"}
	for k, v := range s.Outbound {
		out[k] = v
	}
	cfg := map[string]any{
		"log": map[string]any{"loglevel": "warning"},
		"inbounds": []any{
			map[string]any{
				"tag": "socks", "listen": "127.0.0.1", "port": port, "protocol": "socks",
				"settings": map[string]any{"auth": "password", "udp": false,
					"accounts": []any{map[string]any{"user": user, "pass": pass}}},
			},
			map[string]any{
				"tag": "api", "listen": "127.0.0.1", "port": infoPort, "protocol": "dokodemo-door",
				"settings": map[string]any{"address": "127.0.0.1"},
			},
		},
		"outbounds": []any{out},
		"api":       map[string]any{"tag": "api", "services": []any{"StatsService"}},
		"stats":     map[string]any{},
		"policy":    map[string]any{"system": map[string]any{"statsOutboundUplink": true, "statsOutboundDownlink": true}},
		"routing": map[string]any{"rules": []any{
			map[string]any{"type": "field", "inboundTag": []any{"api"}, "outboundTag": "api"},
		}},
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("config: %w", err)
	}
	return data, nil
}
