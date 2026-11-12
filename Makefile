UUID := hhd-quick-settings@uraniumw.github.io
EXT_DIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
DIST_DIR := dist
SOURCES := extension.js hhdClient.js metadata.json stylesheet.css README.md

.PHONY: all install uninstall pack clean enable

all: pack

install:
	mkdir -p "$(EXT_DIR)"
	install -m 644 $(SOURCES) "$(EXT_DIR)/"
	-gnome-extensions enable "$(UUID)"
	@echo "Installed to $(EXT_DIR)"
	@echo "Log out and back in on Wayland to load the extension."

uninstall:
	rm -rf "$(EXT_DIR)"
	@echo "Removed $(EXT_DIR)"

pack:
	mkdir -p "$(DIST_DIR)"
	gnome-extensions pack --force \
		--extra-source=hhdClient.js \
		--extra-source=README.md \
		--out-dir "$(DIST_DIR)" .
	@echo "Built $(DIST_DIR)/$(UUID).shell-extension.zip"

enable:
	gnome-extensions enable "$(UUID)"

clean:
	rm -rf "$(DIST_DIR)"
