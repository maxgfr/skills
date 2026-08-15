.PHONY: help test lint build dev clean

help:
	@echo "targets: test lint build"

dev:
	go run ./cmd/server

test:
	go test ./...

lint:
	golangci-lint run

build:
	go build -o bin/server ./cmd/server

clean:
	rm -rf bin
