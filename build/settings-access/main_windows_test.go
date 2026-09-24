package main

import (
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

func TestResolveIndividualUser(t *testing.T) {
	current, err := user.Current()
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := resolveUser(current.Username)
	if err != nil || resolved != current.Uid {
		t.Fatalf("resolved %q: %v", resolved, err)
	}
	for _, account := range []string{"", "nonexistent-mcs-user-891dc2"} {
		if _, err := resolveUser(account); err == nil {
			t.Fatalf("accepted %q", account)
		}
	}
	group, err := syscall.StringToSid("S-1-5-32-545")
	if err != nil {
		t.Fatal(err)
	}
	name, domain, _, err := group.LookupAccount("")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := resolveUser(domain + "\\" + name); err == nil {
		t.Fatal("accepted a group")
	}
}

func TestSettingsScope(t *testing.T) {
	root := t.TempDir()
	t.Setenv("ProgramData", root)
	target := filepath.Join(root, "MCS Modbus Toolkit", "runtime", "config")
	if err := os.MkdirAll(target, 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := checkedConfig(target); err != nil {
		t.Fatal(err)
	}
	for _, outside := range []string{root, filepath.Dir(target), filepath.Join(root, "Program Files")} {
		if _, err := checkedConfig(outside); err == nil {
			t.Fatalf("accepted %s", outside)
		}
	}
	if err := grantSettings(target, "S-1-5-32-545", ""); err == nil {
		t.Fatal("granted group access")
	}
	current, err := user.Current()
	if err != nil {
		t.Fatal(err)
	}
	if err := grantSettingsScope(target, current.Uid, "", "all"); err == nil {
		t.Fatal("all users accepted an arbitrary principal")
	}
	if err := grantSettingsScope(target, current.Uid, "", "invalid"); err == nil {
		t.Fatal("accepted an invalid scope")
	}
	if err := grantSettingsScope(target, "S-1-5-32-545", "", "all"); err != nil {
		t.Fatal(err)
	}
	if err := grantSettingsScope(target, current.Uid, "S-1-5-32-545", "current"); err != nil {
		t.Fatal(err)
	}
}

func TestGrantSettingsExistingAndFutureFiles(t *testing.T) {
	root := t.TempDir()
	t.Setenv("ProgramData", root)
	target := filepath.Join(root, "MCS Modbus Toolkit", "runtime", "config")
	directory := filepath.Join(target, "mma2")
	if err := os.MkdirAll(directory, 0700); err != nil {
		t.Fatal(err)
	}
	existing := filepath.Join(directory, "config.yaml")
	if err := os.WriteFile(existing, []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	current, err := user.Current()
	if err != nil {
		t.Fatal(err)
	}
	if err := grantSettings(target, current.Uid, ""); err != nil {
		t.Fatal(err)
	}
	if err := grantSettings(target, current.Uid, current.Uid); err != nil {
		t.Fatal(err)
	}
	future := filepath.Join(directory, "future.yaml")
	if err := os.WriteFile(future, []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	executable := filepath.Join(os.Getenv("SystemRoot"), "System32", "icacls.exe")
	previous := current.Uid[:strings.LastIndex(current.Uid, "-")] + "-500"
	if output, err := exec.Command(executable, target, "/grant", "*"+previous+":(OI)(CI)M", "/T").CombinedOutput(); err != nil {
		t.Fatalf("prepare prior owner: %s %v", output, err)
	}
	if err := grantSettings(target, current.Uid, previous); err != nil {
		t.Fatal(err)
	}
	output, err := exec.Command(executable, target, "/findsid", "*"+previous, "/T").CombinedOutput()
	if err != nil || strings.Contains(strings.ToLower(string(output)), strings.ToLower(target)) {
		t.Fatalf("previous owner retained: %s %v", output, err)
	}
	for _, file := range []string{existing, future} {
		output, err := exec.Command(executable, file, "/findsid", "*"+current.Uid).CombinedOutput()
		if err != nil || !strings.Contains(strings.ToLower(string(output)), strings.ToLower(file)) {
			t.Fatalf("missing account ACL on %s: %s %v", file, output, err)
		}
	}
}
