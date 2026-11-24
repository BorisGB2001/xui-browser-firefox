// Fake xray for host tests: understands "version", "run [-test] -c <conf>" and
// "api statsquery --server=…". Listens on the socks inbound port (accepts and closes).
package main

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"strings"
)

func main() {
	args := os.Args[1:]
	if len(args) == 0 {
		os.Exit(2)
	}
	switch args[0] {
	case "version":
		fmt.Println("Xray 0.0.0 (fake) test\nA unified platform for anti-censorship.")
		return
	case "api":
		fmt.Println(`{"stat":[{"name":"outbound>>>proxy>>>traffic>>>downlink","value":"1000"},{"name":"outbound>>>proxy>>>traffic>>>uplink","value":200}]}`)
		return
	case "run":
	default:
		os.Exit(2)
	}
	var conf string
	test := false
	for i := 1; i < len(args); i++ {
		switch args[i] {
		case "-test":
			test = true
		case "-c":
			i++
			conf = args[i]
		}
	}
	data, err := os.ReadFile(conf)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	var cfg struct {
		Inbounds []struct {
			Protocol string `json:"protocol"`
			Listen   string `json:"listen"`
			Port     int    `json:"port"`
		} `json:"inbounds"`
	}
	if json.Unmarshal(data, &cfg) != nil || len(cfg.Inbounds) == 0 || strings.Contains(string(data), "bad.example") {
		fmt.Println("Xray 0.0.0 (fake)")
		fmt.Println("Failed to start: main: failed to load config files: bad server")
		os.Exit(23)
	}
	if test {
		fmt.Println("Configuration OK.")
		return
	}
	ln, err := net.Listen("tcp", fmt.Sprintf("%s:%d", cfg.Inbounds[0].Listen, cfg.Inbounds[0].Port))
	if err != nil {
		fmt.Println("Failed to start:", err)
		os.Exit(1)
	}
	for {
		c, err := ln.Accept()
		if err != nil {
			return
		}
		c.Close()
	}
}
