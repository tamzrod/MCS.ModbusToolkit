package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strings"
	"syscall"
)

func resolveUser(account string) (string, error) {
	account = strings.TrimSpace(account)
	if account == "" {
		return "", errors.New("enter a Windows user account, such as COMPUTER\\user")
	}
	sid, _, kind, err := syscall.LookupSID("", account)
	if err != nil {
		return "", fmt.Errorf("resolve Windows account: %w", err)
	}
	if kind != 1 {
		return "", errors.New("select an individual Windows user, not a group or service identity")
	}
	return sid.String()
}

func checkedConfig(config string) (string, error) {
	programData := os.Getenv("ProgramData")
	if programData == "" {
		return "", errors.New("ProgramData is unavailable")
	}
	expected := filepath.Join(programData, "MCS Modbus Toolkit", "runtime", "config")
	target, err := filepath.Abs(config)
	if err != nil {
		return "", err
	}
	if !strings.EqualFold(target, expected) {
		return "", errors.New("permissions may only target the Toolkit settings directory")
	}
	for parent := target; ; parent = filepath.Dir(parent) {
		info, err := os.Lstat(parent)
		if err != nil {
			return "", err
		}
		data, ok := info.Sys().(*syscall.Win32FileAttributeData)
		if !ok || data.FileAttributes&syscall.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
			return "", errors.New("redirected settings paths are not supported")
		}
		if filepath.Dir(parent) == parent {
			break
		}
	}
	err = filepath.Walk(target, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		data, ok := info.Sys().(*syscall.Win32FileAttributeData)
		if !ok || data.FileAttributes&syscall.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
			return fmt.Errorf("redirected settings entry: %s", path)
		}
		return nil
	})
	return target, err
}

func grantSettings(config, owner, previous string) error {
	return grantSettingsScope(config, owner, previous, "current")
}

func grantSettingsScope(config, owner, previous, scope string) error {
	if scope != "current" && scope != "all" {
		return errors.New("invalid installation access scope")
	}
	if scope == "all" && owner != "S-1-5-32-545" {
		return errors.New("all-users scope must target the built-in Users group")
	}
	sid, err := syscall.StringToSid(owner)
	if err != nil {
		return err
	}
	_, _, kind, err := sid.LookupAccount("")
	if err != nil {
		return err
	}
	if scope == "current" && kind != 1 {
		return errors.New("settings owner must be an individual Windows user")
	}
	if previous != "" {
		if _, err := syscall.StringToSid(previous); err != nil {
			return err
		}
	}
	target, err := checkedConfig(config)
	if err != nil {
		return err
	}
	executable := filepath.Join(os.Getenv("SystemRoot"), "System32", "icacls.exe")
	run := func(arguments ...string) error {
		command := exec.Command(executable, arguments...)
		command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		output, err := command.CombinedOutput()
		if err != nil {
			return fmt.Errorf("settings permissions: %w: %s", err, output)
		}
		return nil
	}
	if err := run(target, "/grant", "*"+owner+":(OI)(CI)M", "/T", "/L"); err != nil {
		return err
	}
	if previous != "" && previous != owner {
		if err := run(target, "/remove:g", "*"+previous, "/T", "/L"); err != nil {
			return err
		}
	}
	return nil
}

func run() error {
	mode := flag.String("mode", "", "")
	scope := flag.String("scope", "current", "")
	config := flag.String("config", "", "")
	owner := flag.String("owner", "", "")
	previous := flag.String("previous", "", "")
	flag.Parse()
	if flag.NArg() != 0 {
		return errors.New("unexpected arguments")
	}
	switch *mode {
	case "current-user":
		account, err := user.Current()
		if err != nil {
			return err
		}
		resolved, err := resolveUser(account.Username)
		if err != nil {
			return err
		}
		fmt.Print(resolved)
		return nil
	case "grant":
		return grantSettingsScope(*config, *owner, *previous, *scope)
	default:
		return errors.New("unsupported settings-access operation")
	}
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
