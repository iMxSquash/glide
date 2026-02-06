#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const APP_NAME = 'Glide';

/**
 * @param {string} cmd
 */
function exec(cmd) {
    try {
        return execSync(cmd, { encoding: 'utf-8' });
    } catch (error) {
        console.error(`Error: ${error.message}`);
        return null;
    }
}

/**
 * Enable autostart on Windows
 */
function enableAutostartWindows() {
    console.log('\n🪟 Setting up Windows autostart...');

    const exePath = path.join(process.cwd(), 'apps', 'server-electron', 'out', `${APP_NAME} Setup.exe`);

    if (!fs.existsSync(exePath)) {
        console.error(`❌ Executable not found: ${exePath}`);
        console.log('   Run: npm run dist:win first');
        return;
    }

    // Add to Windows Registry for autostart
    const regKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
    const regValue = `${APP_NAME}`;

    exec(`reg add "${regKey}" /v "${regValue}" /t REG_SZ /d "${exePath}" /f`);

    console.log(`✅ ${APP_NAME} will start automatically on Windows login`);
}

/**
 * Disable autostart on Windows
 */
function disableAutostartWindows() {
    console.log('\n🪟 Removing Windows autostart...');

    const regKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
    const regValue = `${APP_NAME}`;

    exec(`reg delete "${regKey}" /v "${regValue}" /f`);

    console.log(`✅ ${APP_NAME} autostart removed`);
}

/**
 * Enable autostart on macOS
 */
function enableAutostartMacOS() {
    console.log('\n🍎 Setting up macOS autostart...');

    const appPath = path.join(process.cwd(), 'apps', 'server-electron', 'out', 'mac', `${APP_NAME}.app`);

    if (!fs.existsSync(appPath)) {
        console.error(`❌ App not found: ${appPath}`);
        console.log('   Build for macOS first');
        return;
    }

    // Use osascript to add Login Item
    const script = `
    tell application "System Events"
      make login item at end with properties {path:"${appPath}", hidden:false}
    end tell
  `;

    exec(`osascript -e '${script.replace(/\n/g, ' ')}'`);

    console.log(`✅ ${APP_NAME} will start automatically on macOS login`);
    console.log('   You can also manage this in System Preferences > Users & Login Items');
}

/**
 * Disable autostart on macOS
 */
function disableAutostartMacOS() {
    console.log('\n🍎 Removing macOS autostart...');

    const script = `
    tell application "System Events"
      delete login item "${APP_NAME}"
    end tell
  `;

    exec(`osascript -e '${script.replace(/\n/g, ' ')}'`);

    console.log(`✅ ${APP_NAME} autostart removed`);
}

/**
 * Main
 */
function main() {
    const args = process.argv.slice(2);
    const command = args[0] || 'enable';

    console.log(`\n🚀 ${APP_NAME} Autostart Setup`);
    console.log(`Platform: ${os.platform()}`);

    if (os.platform() === 'win32') {
        if (command === 'enable') {
            enableAutostartWindows();
        } else if (command === 'disable') {
            disableAutostartWindows();
        } else {
            console.log('Usage: node setup-autostart.js [enable|disable]');
        }
    } else if (os.platform() === 'darwin') {
        if (command === 'enable') {
            enableAutostartMacOS();
        } else if (command === 'disable') {
            disableAutostartMacOS();
        } else {
            console.log('Usage: node setup-autostart.js [enable|disable]');
        }
    } else {
        console.log('⚠️  Platform not supported');
    }
}

main();
