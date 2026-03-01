#!/bin/bash

set -eu

# Script metadata
readonly SCRIPT_VERSION="0.1.0"
readonly SCRIPT_NAME="imh-backup-manager"

# Color codes
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly BLUE='\033[0;34m'
readonly BRIGHTBLUE='\033[1;34m'
readonly YELLOW='\033[1;33m'
readonly NC='\033[0m'

# Get the directory where this script lives (source of files to install)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

check_root() {
    if [[ $EUID -ne 0 ]]; then
        echo -e "${RED}ERROR: This script must be run as root${NC}" >&2
        exit 1
    fi
}

print_message() {
    local color=$1
    local message=$2
    echo -e "${color}${message}${NC}"
}

error_exit() {
    print_message "$RED" "ERROR: $1" >&2
    exit 1
}

detect_control_panel() {
    if [[ (-d /usr/local/cpanel || -d /var/cpanel || -d /etc/cpanel) &&
        (-f /usr/local/cpanel/cpanel || -f /usr/local/cpanel/version) ]]; then
        echo "cpanel"
    elif [[ -d /usr/local/cwpsrv ]]; then
        echo "cwp"
    else
        echo "none"
    fi
}

copy_if_changed() {
    local src="$1"
    local dest="$2"
    if [[ -f "$dest" ]]; then
        if cmp -s "$src" "$dest"; then
            print_message "$GREEN" "No change for $dest"
            return
        else
            print_message "$YELLOW" "Replacing $dest"
        fi
    else
        print_message "$GREEN" "Installing $dest"
    fi
    cp -p "$src" "$dest"
}

create_directory() {
    local dir=$1
    local perms=${2:-755}
    if [[ ! -d "$dir" ]]; then
        mkdir -p "$dir" || error_exit "Failed to create directory: $dir"
        chmod "$perms" "$dir" || error_exit "Failed to set permissions on: $dir"
        print_message "$GREEN" "Created directory: $dir"
    fi
}

# ---- Uninstall ----

if [[ "${1:-}" == "--uninstall" ]]; then
    echo -e "${RED}Uninstalling $SCRIPT_NAME...${NC}"
    echo ""

    panel=$(detect_control_panel)

    case "$panel" in
    "cpanel")
        echo "Removing cPanel plugin files..."
        rm -rf "/usr/local/cpanel/whostmgr/docroot/cgi/$SCRIPT_NAME"
        rm -f "/usr/local/cpanel/whostmgr/docroot/addon_plugins/$SCRIPT_NAME.png"
        if [[ -x "/usr/local/cpanel/bin/unregister_appconfig" ]]; then
            /usr/local/cpanel/bin/unregister_appconfig "$SCRIPT_NAME" || true
        fi
        ;;
    "cwp")
        echo "Removing CWP plugin files..."
        rm -f "/usr/local/cwpsrv/htdocs/resources/admin/modules/$SCRIPT_NAME.php"
        rm -f "/usr/local/cwpsrv/htdocs/admin/design/img/$SCRIPT_NAME.png"
        rm -f "/usr/local/cwpsrv/htdocs/admin/design/js/$SCRIPT_NAME.js"
        ;;
    *)
        echo "Removing plain install files..."
        rm -rf "/root/$SCRIPT_NAME"
        ;;
    esac

    echo ""
    echo -e "${GREEN}Uninstall complete.${NC}"
    exit 0
fi

# ---- cPanel Install ----

install_cpanel() {
    print_message "$YELLOW" "Installing for cPanel..."
    echo ""

    create_directory "/var/cpanel/apps"
    create_directory "/usr/local/cpanel/whostmgr/docroot/cgi/$SCRIPT_NAME"

    print_message "$BRIGHTBLUE" "Installing files..."

    copy_if_changed "$SCRIPT_DIR/index.php" \
        "/usr/local/cpanel/whostmgr/docroot/cgi/$SCRIPT_NAME/index.php"

    copy_if_changed "$SCRIPT_DIR/$SCRIPT_NAME.conf" \
        "/usr/local/cpanel/whostmgr/docroot/cgi/$SCRIPT_NAME/$SCRIPT_NAME.conf"

    copy_if_changed "$SCRIPT_DIR/$SCRIPT_NAME.js" \
        "/usr/local/cpanel/whostmgr/docroot/cgi/$SCRIPT_NAME/$SCRIPT_NAME.js"

    copy_if_changed "$SCRIPT_DIR/$SCRIPT_NAME.png" \
        "/usr/local/cpanel/whostmgr/docroot/cgi/$SCRIPT_NAME/$SCRIPT_NAME.png"

    # Set permissions
    chmod 755 "/usr/local/cpanel/whostmgr/docroot/cgi/$SCRIPT_NAME/index.php"

    # Copy icon to addon_plugins for WHM sidebar
    if [[ -d "/usr/local/cpanel/whostmgr/docroot/addon_plugins" ]]; then
        copy_if_changed "$SCRIPT_DIR/$SCRIPT_NAME.png" \
            "/usr/local/cpanel/whostmgr/docroot/addon_plugins/$SCRIPT_NAME.png" \
            || print_message "$YELLOW" "Warning: Failed to copy icon to addon_plugins"
    fi

    # Register plugin
    echo ""
    print_message "$BRIGHTBLUE" "Registering plugin..."
    if [[ -x "/usr/local/cpanel/bin/register_appconfig" ]]; then
        if [[ -f "/var/cpanel/apps/$SCRIPT_NAME.conf" ]]; then
            print_message "$YELLOW" "Plugin already registered."
        else
            /usr/local/cpanel/bin/register_appconfig \
                "/usr/local/cpanel/whostmgr/docroot/cgi/$SCRIPT_NAME/$SCRIPT_NAME.conf" \
                || error_exit "Failed to register plugin"
        fi
    else
        error_exit "register_appconfig not found"
    fi
}

# ---- CWP Install ----

install_cwp() {
    print_message "$YELLOW" "Installing for CWP..."
    echo ""

    [[ -d "/usr/local/cwpsrv/htdocs/resources/admin/modules" ]] \
        || error_exit "CWP modules directory not found"

    # Remove immutable attributes if they exist
    if command -v chattr >/dev/null 2>&1; then
        chattr -ifR /usr/local/cwpsrv/htdocs/admin 2>/dev/null || true
    fi

    print_message "$BRIGHTBLUE" "Installing files..."

    copy_if_changed "$SCRIPT_DIR/$SCRIPT_NAME.php" \
        "/usr/local/cwpsrv/htdocs/resources/admin/modules/$SCRIPT_NAME.php"
    chmod 755 "/usr/local/cwpsrv/htdocs/resources/admin/modules/$SCRIPT_NAME.php"

    create_directory "/usr/local/cwpsrv/htdocs/admin/design/img"
    create_directory "/usr/local/cwpsrv/htdocs/admin/design/js"
    create_directory "/usr/local/cwpsrv/htdocs/resources/admin/include"

    copy_if_changed "$SCRIPT_DIR/$SCRIPT_NAME.png" \
        "/usr/local/cwpsrv/htdocs/admin/design/img/$SCRIPT_NAME.png"

    copy_if_changed "$SCRIPT_DIR/$SCRIPT_NAME.js" \
        "/usr/local/cwpsrv/htdocs/admin/design/js/$SCRIPT_NAME.js"

    copy_if_changed "$SCRIPT_DIR/imh-plugins.php" \
        "/usr/local/cwpsrv/htdocs/resources/admin/include/imh-plugins.php"

    # Update 3rdparty.php to include our menu
    update_cwp_config
}

update_cwp_config() {
    local target="/usr/local/cwpsrv/htdocs/resources/admin/include/3rdparty.php"
    local include_file="/usr/local/cwpsrv/htdocs/resources/admin/include/imh-plugins.php"
    local include_statement="include('${include_file}');"

    [[ -f "$target" ]] || error_exit "Target file does not exist: $target"
    [[ -r "$target" && -w "$target" ]] || error_exit "Cannot read/write: $target"
    [[ -f "$include_file" ]] || error_exit "Include file does not exist: $include_file"

    # Skip if already present
    if grep -Eq "include\s*\(['\"]${include_file}['\"]\)|require(_once)?\s*\(['\"]${include_file}['\"]\)" "$target"; then
        print_message "$YELLOW" "Include line already exists. No changes made."
        return 0
    fi

    local temp_file
    temp_file=$(mktemp "${target}.XXXXXX") || error_exit "Failed to create temp file"

    if grep -q "<\?php" "$target"; then
        if grep -Eq "<\?php.*\?>" "$target"; then
            sed -E "0,/<\?php.*\?>/s#(<\?php)(.*)(\?>)#\1\n${include_statement}\n\2\n\3#" "$target" > "$temp_file"
        elif grep -q "?>" "$target"; then
            awk -v inc="$include_statement" '
                BEGIN {done=0}
                /<\?php/ { print; next }
                /\?>/ && !done { print inc; done=1 }
                { print }
            ' "$target" > "$temp_file"
        else
            awk -v inc="$include_statement" '
                /<\?php/ { print; print inc; next }
                { print }
            ' "$target" > "$temp_file"
        fi
    else
        {
            echo "<?php"
            echo "$include_statement"
            cat "$target"
        } > "$temp_file"
    fi

    # Validate PHP syntax
    if command -v php >/dev/null 2>&1; then
        if ! php -l "$temp_file" >/dev/null 2>&1; then
            rm -f "$temp_file"
            error_exit "Modified file has PHP syntax errors. Aborting."
        fi
    fi

    mv "$temp_file" "$target" || error_exit "Failed to update $target"
    print_message "$GREEN" "Successfully added include statement to $target"
}

# ---- Plain Install (no control panel) ----

install_plain() {
    print_message "$GREEN" "Installing plain (no control panel)..."
    echo ""

    local dest="/root/$SCRIPT_NAME"
    create_directory "$dest" 700

    print_message "$BRIGHTBLUE" "Installing files..."
    copy_if_changed "$SCRIPT_DIR/index.php" "$dest/index.php"
    copy_if_changed "$SCRIPT_DIR/$SCRIPT_NAME.js" "$dest/$SCRIPT_NAME.js"
    copy_if_changed "$SCRIPT_DIR/$SCRIPT_NAME.png" "$dest/$SCRIPT_NAME.png"
    chmod 700 "$dest/index.php"
    chmod 600 "$dest/$SCRIPT_NAME.js" "$dest/$SCRIPT_NAME.png"

    print_message "$GREEN" "Plain install complete. Files installed to $dest"
}

# ---- Main ----

main() {
    print_message "$RED" "Installing $SCRIPT_NAME plugin v$SCRIPT_VERSION..."
    echo ""

    check_root

    # Verify source files exist
    for f in index.php "$SCRIPT_NAME.php" "$SCRIPT_NAME.js" "$SCRIPT_NAME.conf" "$SCRIPT_NAME.png"; do
        [[ -f "$SCRIPT_DIR/$f" ]] || error_exit "Missing source file: $SCRIPT_DIR/$f"
    done

    local panel
    panel=$(detect_control_panel)

    case "$panel" in
    "cpanel")
        install_cpanel
        ;;
    "cwp")
        install_cwp
        ;;
    *)
        install_plain
        ;;
    esac

    echo ""
    print_message "$BLUE" "Installation complete!"
}

main "$@"
