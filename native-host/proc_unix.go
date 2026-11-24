//go:build !windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func hideWindow(*exec.Cmd) {}

// startDetached runs xray in its own session so it outlives the host
// process and is not hit by signals sent to Firefox's process group.
func startDetached(newCmd func() *exec.Cmd) (*exec.Cmd, string, error) {
	cmd := newCmd()
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	return cmd, "", cmd.Start()
}

// processName returns the executable name of pid, or "" when unknown.
func processName(pid int) string {
	// Linux: /proc works everywhere, while "ps -p" is missing in BusyBox and
	// /bin/ps does not exist on NixOS.
	if data, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/comm"); err == nil {
		return strings.TrimSpace(string(data))
	}
	out, err := exec.Command("/bin/ps", "-p", strconv.Itoa(pid), "-o", "comm=").Output()
	if err != nil {
		return ""
	}
	return filepath.Base(strings.TrimSpace(string(out)))
}

// coreAlive reports whether pid is a running xray process (pids get reused).
func coreAlive(pid int) bool {
	if pid <= 1 || syscall.Kill(pid, 0) != nil {
		return false
	}
	return processName(pid) == coreName
}

func terminate(pid int) {
	syscall.Kill(pid, syscall.SIGTERM)
	for i := 0; i < 30; i++ {
		if !coreAlive(pid) {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	syscall.Kill(pid, syscall.SIGKILL)
}
