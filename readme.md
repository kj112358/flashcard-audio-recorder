# package
npm run make -- --platform win32
npm run make -- --platform linux
npm run make -- --platform darwin

# Install
## Linux (TODO: Improve build process so deb will auto-extract to .local/share)
sudo dpkg -i --prefix="$HOME/.local/share" out/make/deb/x64/flashcard-audio-recorder_1.0.0_amd64.deb
## That didn't work. Try a flatpak instead. Or just move on to windows for now..