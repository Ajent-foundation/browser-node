#!/bin/bash

main() {
    run_env_setup             # Setup environment variables
    run_xvfb                  # Xvfb a virtual X server
    run_openbox               # Openbox a lightweight window manager
    run_polybar               # Polybar a status bar
}

run_xvfb() {
    echo "[INFO] Starting Xvfb..."

    local resolution=${XVFB_RESOLUTION:-1280x1024}
    local depth=${XVFB_DEPTH:-24}
    local DPI=${XVFB_DPI:-96}
    local timeout=${WAIT_FOR_PROCESS_TIMEOUT:-30}

    Xvfb :1 -screen 0 "${resolution}x${depth}" -dpi ${DPI} -ac +extension RANDR -nolisten tcp &
    export DISPLAY=:1
    Xvfb_pid=$!

    # Wait for Xvfb to be fully up or timeout
    start_time=$(date +%s)
    while ! xdpyinfo -display :1 >/dev/null 2>&1; do
        current_time=$(date +%s)
        elapsed_time=$((current_time - start_time))
        if [ $elapsed_time -ge $timeout ]; then
            echo "[ERROR] Xvfb failed to start within ${timeout} seconds."
            kill -SIGTERM $Xvfb_pid 2>/dev/null
            exit 1
        fi
        sleep 0.5
    done

    echo "[PID]-${Xvfb_pid}"
}

run_env_setup(){
    export CHROME_USER_DATA_DIR="/home/user/.config/chrome"
    export WAIT_FOR_PROCESS_TIMEOUT=10
    
    # Create necessary directories for browser data (tmpfs mounts are empty)
    mkdir -p /home/user/temp/Default
    mkdir -p /home/user/.config/chrome
    mkdir -p /home/user/session
    mkdir -p /home/user/downloads
    mkdir -p /home/user/uploads
    
    # Set proper permissions
    chown -R user:user /home/user/temp /home/user/.config/chrome /home/user/session /home/user/downloads /home/user/uploads 2>/dev/null || true
}

run_openbox() {
    echo "[INFO] Starting Openbox..."

    local timeout=${WAIT_FOR_PROCESS_TIMEOUT:-30} 
    openbox --config-file "/home/user/.config/openbox/rc.xml" &
    Openbox_pid=$!

    # Wait for Openbox to be ready or timeout
    start_time=$(date +%s)
    while ! xprop -root | grep -q _OB_VERSION; do
        current_time=$(date +%s)
        elapsed_time=$((current_time - start_time))
        if [ $elapsed_time -ge $timeout ]; then
            echo "[ERROR] Openbox failed to start within ${timeout} seconds."
            kill -SIGTERM $Openbox_pid 2>/dev/null
            exit 1
        fi
        sleep 0.5
    done

    feh --bg-fill /home/user/wallpapers/desktop.png &
    echo "[PID]-${Openbox_pid}"
}

run_polybar() {
    echo "[INFO] Starting polybar..."

    polybar -c /home/user/.config/polybar/config.ini main > /dev/null 2>&1 &
    Polybar_pid=$!

    echo "[PID]-${Polybar_pid}"
}

main
exit 0