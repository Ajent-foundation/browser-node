# First stage: Build the application
FROM node:18.17-alpine AS builder

WORKDIR /home/app

COPY package.json package-lock.json ./

RUN npm install

COPY . .

RUN npm run build

# Second stage: Create the final image
FROM debian

# Variables
ARG NODE_MAJOR=20
ARG TARGETARCH

# Update and clean
RUN apt-get update && \ 
    apt-get clean

# Virtual desktop programs
# xvfb - Virtual framebuffer
# openbox - Window manager
# feh - Image viewer
# x11vnc - VNC server
# lxpanel - Panel with menu and system tray
# rofi - Application launcher
# stunnel4 - SSL tunnel
# xterm - Standard terminal
# pulseaudio - Sound server
RUN apt-get install -y \
    xvfb \          
    openbox \
    feh \
    x11vnc \
    rofi \
    lxpanel \
    stunnel4 \ 
    xterm \
    pulseaudio \
    ffmpeg \
    unzip \
    xdotool \ 
    scrot \
    lsof \
    vim \
    patch \
    xclip \
    x11-utils \
    procps \
    git \
    pcmanfm \
    mousepad \
    evince \
    eog \
    gnome-calculator \
    gnome-system-monitor \
    gnome-screenshot \
    gnome-terminal \
    gimp \
    vlc \
    libreoffice-writer

# Google Chrome dependencies
RUN apt-get install -y \
    fonts-liberation \
    libgbm1 \
    libnspr4 \
    libnss3 \
    libu2f-udev \
    libvulkan1 \
    wget \
    xdg-utils \
    menu \
    socat \
    libxss1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libgtk-3-0 

# Python for mitmproxy (allow system pip installs on Debian per PEP 668)
RUN apt-get update && apt-get install -y python3 python3-pip && pip3 install --no-cache-dir --break-system-packages mitmproxy

# Install Node.js and npm
RUN apt-get update && apt-get install -y ca-certificates curl gnupg && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && apt-get install nodejs -y

# Add a user for running applications.
# Createe config files
RUN useradd user && \
    mkdir /home/user && \
    chown -R user:user /home/user &&\
    mkdir /home/user/wallpapers &&\
    mkdir /home/user/temp && \
    mkdir /home/user/temp/Default && \
    mkdir /home/user/.config && \
    mkdir -p /home/user/.config/openbox && \
    mkdir -p /home/user/.config/lxpanel/default && \
    mkdir /home/user/.themes && \
    mkdir -p /home/user/.local/share/fonts && \
    mkdir /home/user/app && \
    mkdir /home/user/extensions && \
    mkdir /home/mitmproxy && \
    mkdir /home/user/session && \
    mkdir /home/user/uploads && \
    mkdir /home/user/downloads
    
# Copy configs
COPY --from=builder /home/app/container/openbox/ /home/user/.config/openbox/
COPY --from=builder /home/app/container/lxpanel/ /home/user/.config/lxpanel/
COPY --from=builder /home/app/container/chrome/Preferences /home/user/temp/Default/Preferences

ARG sourc="/home/app/container/chrome/Local State"
ARG destination="/home/user/temp/Local State"
COPY --from=builder ${sourc} ${destination}

# Copy fonts
COPY --from=builder /home/app/container/fonts/Ubuntu/* /home/user/.local/share/fonts/

# Copy wallpapers
COPY --from=builder /home/app/container/wallpapers/desktop.png /home/user/wallpapers/desktop.png

# Copy Boot script
COPY --from=builder /home/app/container/onBoot.sh /home/
COPY --from=builder /home/app/container/onPreBrowserRun.sh /home/

# Copy Extensions
COPY --from=builder /home/app/container/extensions/* /home/user/extensions/

# Navigate to the directory containing the extensions
WORKDIR /home/user/extensions

# Install unzip
RUN apt-get update && apt-get install -y unzip

# Rename all .crx files to .zip and unzip them into their own directory
RUN find . -name "*.crx" -exec sh -c 'mv "$1" "${1%.crx}.zip"' _ {} \; && \
    find . -name "*.zip" -exec sh -c 'mkdir "${1%.*}" && unzip -d "${1%.*}" "$1"' _ {} \; && \
    find . -name "*.zip" -delete

# Copy App
COPY --from=builder /home/app/websockify /home/user/app/websockify/
COPY --from=builder /home/app/cdp-interceptor /home/user/app/cdp-interceptor/
COPY --from=builder /home/app/build /home/user/app/src/
COPY --from=builder /home/app/configs /home/user/app/configs/
COPY --from=builder /home/app/package.json /home/app/package-lock.json /home/user/app/
COPY --from=builder /home/app/.env /home/user/app/


# Add build argument at the top with Chrome as default
ARG BROWSER=chrome

# Modify the browser installation section
RUN if [ "$BROWSER" = "brave" ]; then \
    apt-get update && \
    apt-get install -y curl && \
    curl -fsSLo /usr/share/keyrings/brave-browser-archive-keyring.gpg https://brave-browser-apt-release.s3.brave.com/brave-browser-archive-keyring.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/brave-browser-archive-keyring.gpg arch=${TARGETARCH}] https://brave-browser-apt-release.s3.brave.com/ stable main" | tee /etc/apt/sources.list.d/brave-browser-release.list && \
    apt-get update && \
    apt-get install -y brave-browser && \
    ln -s /usr/bin/brave-browser /usr/bin/google-chrome; \
elif [ "$BROWSER" = "chrome" ]; then \
    wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && \
    dpkg -i google-chrome-stable_current_amd64.deb && \
    apt-get install -f && \
    rm google-chrome-stable_current_amd64.deb; \
fi

# Grant user permissions required for Chrome
RUN mkdir -p /home/user/.config/chrome && chown -R user:user /home/user/.config/chrome
RUN mkdir -p /home/user/.local/share/applications && \
    mkdir -p /.local/share/applications && \
    mkdir -p /home/user/.config/pulse && \
    chown -R user:user /.local/share/applications && \
    chown -R user:user /home/user/.local/share/applications && \
    chown -R user:user /home/user/app/websockify/ && \
    chown -R user:user /home/user/app/ && \
    chown -R user:user /home/mitmproxy/ && \
    chown -R user:user /home/user/.config/pulse && \
    chmod +x /usr/bin/google-chrome

RUN mkdir -p /home/user/.config/google-chrome/Crashpad && \
    chown -R user:user /home/user/.config/google-chrome/

# Make Executables
RUN chmod +x /home/onBoot.sh
RUN chmod +x /home/onPreBrowserRun.sh

# Ports
# 15900 - VNC
# 19222 - Remote Chrome debugging
# 8080  - Express Web server
EXPOSE 15900 19222 8080

WORKDIR /home/user/app
RUN npm install --omit=dev

# Build websockify
WORKDIR /home/user/app/websockify
RUN npm install
RUN npm run build

# Build cdp-interceptor
WORKDIR /home/user/app/cdp-interceptor
RUN npm install
RUN npm run build

WORKDIR /home/user/app

#USER user

# Run node app
CMD ["node", "src/main.js"]