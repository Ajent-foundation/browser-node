#!/bin/bash

main() {
    setup_locale_and_timezone  # Setup locale and timezone
    change_xvfb_resolution    # Change Xvfb resolution
    run_pulseaudio            # Pulseaudio
    create_virtual_sinks      # Create virtual sinks
    create_virtual_sources    # Create virtual sources
    # create_virtual_cameras    # Create virtual cameras
    run_vnc_server            # VNC server
    run_OldWebSocify             # VNC WebSocify
    run_mitmproxy             # mitmproxy
    run_NewWebSocify      # Websocket server
}

# New function to setup locale and timezone
setup_locale_and_timezone() {
    # Set locale if provided
    if [ -n "${LOCALE}" ]; then
        echo "[INFO] Setting locale to ${LOCALE}"
        export LANG="${LOCALE}"
        export LC_ALL="${LOCALE}"
    else
        # Default to en_US.UTF-8 if no locale specified
        echo "[INFO] No locale specified, defaulting to en_US.UTF-8"
        export LANG="en_US.UTF-8"
        export LC_ALL="en_US.UTF-8"
    fi

    # Set system language if provided
    if [ -n "${LANGUAGE}" ]; then
        echo "[INFO] Setting system language to ${LANGUAGE}"
        export LANGUAGE="${LANGUAGE}"
    fi

    # Set timezone if provided
    if [ -n "${TIMEZONE}" ]; then
        echo "[INFO] Setting timezone to ${TIMEZONE}"
        if [ -f "/usr/share/zoneinfo/${TIMEZONE}" ]; then
            ln -sf "/usr/share/zoneinfo/${TIMEZONE}" /etc/localtime
            export TZ="${TIMEZONE}"
        else
            echo "[WARN] Invalid timezone: ${TIMEZONE}"
        fi
    fi
}

change_xvfb_resolution() {
    local resolution=${XVFB_RESOLUTION:-1280x1024}
    local depth=${XVFB_DEPTH:-24}
    local DPI=${XVFB_DPI:-96}

    # Check if xrandr is available and can be used
    if ! which xrandr >/dev/null; then
        echo "[ERROR] xrandr is not installed or not found in PATH."
        return 1
    fi

    # Check the current resolution and compare it with the desired resolution
    local current_resolution=$(xrandr --display :1 | grep '*' | awk '{print $1}')

    if [ "$current_resolution" = "$resolution" ]; then
        echo "[INFO] The current resolution ($current_resolution) is already set to the default ($resolution). No adjustment needed."
        return 0
    fi

   # If xrandr fails to set the new resolution
    if ! xrandr --display :1 --size ${resolution}; then
        # Kill all X-dependent processes first
        pkill lxpanel 2>/dev/null
        pkill openbox 2>/dev/null
        pkill -9 Xvfb 2>/dev/null
        
        # Wait for processes to die
        sleep 1
        
        # Force remove lock files
        rm -f /tmp/.X1-lock
        rm -f /tmp/.X11-unix/X1
        
        # Double check Xvfb is dead, force kill if still running
        if pgrep Xvfb > /dev/null 2>&1; then
            pkill -9 Xvfb 2>/dev/null
            sleep 0.5
        fi
        
        # Start new Xvfb with requested resolution
        Xvfb :1 -screen 0 "${resolution}x24" -dpi ${DPI} -ac +extension RANDR -nolisten tcp &
        export DISPLAY=:1
        
        # Wait for new Xvfb to be ready (with timeout)
        local timeout=10
        local count=0
        while ! xdpyinfo -display :1 >/dev/null 2>&1; do
            sleep 0.5
            count=$((count + 1))
            if [ $count -ge $timeout ]; then
                echo "[ERROR] Xvfb failed to start after ${timeout} attempts"
                break
            fi
        done

        # Restart Openbox
        openbox --config-file "/home/user/.config/openbox/rc.xml" &
        
        # Wait for Openbox to be ready
        while ! xprop -root | grep -q _OB_VERSION; do
            sleep 0.5
        done

        # Set wallpaper
        feh --bg-fill /home/user/wallpapers/desktop.png &

        # Restart LXPanel
        if [ -f "/home/user/.config/lxpanel/default/config" ]; then
            lxpanel --profile default > /dev/null 2>&1 &
        else
            lxpanel > /dev/null 2>&1 &
        fi
    fi
    echo "[INFO] Resolution changed to ${resolution}."
}

# TODO - permission issues
# create_virtual_cameras() {
#     local num_cameras="${NUM_CAMERAS:-1}"
#     local i=1
# 
#     # Create a 5-second black video
#     ffmpeg -f lavfi -i color=c=black:s=1280x720:d=5 /home/black.mp4
# 
#     # Load the v4l2loopback module
#     modprobe v4l2loopback devices=$num_cameras
# 
#     while [ $i -le $num_cameras ]
#     do
#         # Send video to the virtual webcam
#         # ffmpeg -re -i /path/to/video.mp4 -map 0:v -f v4l2 /dev/video${i} &
#         ffmpeg -re -stream_loop -1 -i /home/black.mp4 -map 0:v -f v4l2 /dev/video${i} &
#         i=$((i + 1))
#     done
# }

run_pulseaudio() {
    pulseaudio -D --exit-idle-time=-1 --disable-shm=1 --disallow-exit --log-level=0
}

# Function to create virtual sinks
create_virtual_sinks() {
    local num_speakers="${NUM_SPEAKERS:-1}"
    local i=1

    while [ $i -le $num_speakers ]
    do
        pacmd load-module module-null-sink sink_name="Speaker_${i}" sink_properties=device.description="Speaker_${i}"
        i=$((i + 1))
    done

    # Set default sink
    pacmd set-default-sink "Speaker_1"
}

# Function to create virtual sources
create_virtual_sources() {
    local num_microphones="${NUM_MICROPHONES:-1}"
    local i=1

    while [ $i -le $num_microphones ]
    do
        pacmd load-module module-virtual-source source_name="Microphone_${i}"
        i=$((i + 1))
    done

    # Set default mic
    pacmd set-default-source "Microphone_1"
}

run_vnc_server() {
    echo "[INFO] Starting VNC server..."
    local passwordArgument='-nopw'

    if [ -n "${VNC_SERVER_PASSWORD}" ]
    then
        local passwordFilePath="${HOME}/x11vnc.pass"
        if ! x11vnc -storepasswd "${VNC_SERVER_PASSWORD}" "${passwordFilePath}" 2>/dev/null
        then
            echo "[ERROR] Failed to store x11vnc password."
            exit 1
        fi
        passwordArgument=-"-rfbauth ${passwordFilePath}"
        echo "[INFO] The VNC server will run with a password."
    else
        echo "[WARN] The VNC server will run without a password."
    fi

    local viewOnlyArgument=""
    if [ -n "${VNC_VIEW_ONLY}" ]; then
        viewOnlyArgument="-viewonly"
        echo "[INFO] The VNC server will run in view-only mode."
    else
        echo "[INFO] The VNC server will allow interactions."
    fi

    x11vnc -display :1 -rfbport 5900 -geometry $(xdpyinfo -display :1 | grep 'dimensions:' | awk '{print $2}') -noncache -forever -shared ${passwordArgument} ${viewOnlyArgument} -q -bg & #2>/dev/null
    VNC_pid=$!

    echo "[INFO] VNC is exposed on localhost:5900"
    echo "[PID]-${VNC_pid}"
}

run_OldWebSocify() {
    # Only run old websockify if NEW_WEBSOCKIFY_ENABLED is false
    if [ "${NEW_WEBSOCKIFY_ENABLED:-false}" = "true" ]; then
        return
    fi
    
    if [ -n "$VNC_SERVER_ENABLED" ]; then
        echo "[INFO] Starting Old WebSocify..."
        local VNC_WS_PORT=${VNC_WS_PORT:-15900}
        
        if [ -z "$VNC_NO_SSL" ]; then
            echo "VNC_NO_SSL is not set. Running command with SSL."
            node /home/user/app/websockify/websockify.js --cert /home/user/app/websockify/cert.pem --key /home/user/app/websockify/key.pem localhost:$VNC_WS_PORT 0.0.0.0:5900 > /dev/null 2>&1 &
        else
            echo "VNC_NO_SSL is set. Running command without SSL."
            node /home/user/app/websockify/websockify.js localhost:$VNC_WS_PORT 0.0.0.0:5900 > /dev/null 2>&1 &
        fi
    
        WebSocify_pid=$!
    
        echo "[PID]-${WebSocify_pid}"
    fi
}

run_mitmproxy() {
    # Check if all arguments are provided
    if [ -z "$PROXY_URL" ] || [ -z "$PROXY_USERNAME" ] || [ -z "$PROXY_PASSWORD" ]; then
        echo "[WARN] Missing arguments. Please provide PROXY_PORT, url, username, and password."
        return 1
    fi

    echo "[INFO] Starting mitmproxy..."
    mitmdump --certs *=/home/mitmproxy/mitmproxy-ca-cert.pem -p 8081 --mode upstream:https://${PROXY_URL} --upstream-auth ${PROXY_USERNAME}:${PROXY_PASSWORD} > /dev/null 2>&1 &
    mitmproxy_pid=$!

    echo "[PID]-${mitmproxy_pid}"

    # Run a health check to ensure proxy is initialized
    start_time=$(date +%s)
    max_attempts=15 #15 attempts with 1s delay
    attempt=0

    # Health check loop
    while ! curl --proxy http://localhost:8081 --silent --fail http://ipinfo.io/json -o /dev/null; do
        attempt=$((attempt + 1))
        echo "[INFO] Waiting for mitmproxy to be ready... Attempt $attempt of $max_attempts"

        # Break and resume normally after it exceeds the timeframe
        if [ $attempt -ge $max_attempts ]; then
            echo "[ERROR] mitmproxy did not become ready within the expected timeframe."
            break
        fi

        sleep 1
    done

    # Calculate and log the elapsed time
    end_time=$(date +%s)
    elapsed_time=$(($end_time - $start_time))
    echo "[INFO] mitmproxy is ready. Initialization took ${elapsed_time} seconds."
}

run_NewWebSocify() {
    # Only run new websockify if NEW_WEBSOCKIFY_ENABLED is true
    if [ "${NEW_WEBSOCKIFY_ENABLED:-false}" != "true" ]; then
        return
    fi

    # get max connections from env along with other params
    local max_connections=${MAX_CONNECTIONS:-10}
    local password=${VNC_SERVER_PASSWORD:-}
    local VNC_WS_PORT=${VNC_WS_PORT:-15900}

    echo "[INFO] Starting New WebSocify..."
    # Set NODE_OPTIONS as an environment variable before the command
    export NODE_OPTIONS=--openssl-legacy-provider
    cmd="node /home/user/app/websockify/main.js --port ${VNC_WS_PORT} --target-host localhost --target-port 5900 --max-connections ${max_connections}"
    
    # Add password only if provided
    if [ -n "$password" ]; then
        cmd="$cmd --password $password"
    fi
    
    echo "$cmd"
    $cmd > /dev/null 2>&1 &
    NewWebSocify_pid=$!
    
    # Only return PID if process is running
    if ps -p $NewWebSocify_pid > /dev/null; then
        echo "[PID]-${NewWebSocify_pid}"
    fi
}

main
exit 0