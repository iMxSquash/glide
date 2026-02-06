#!/usr/bin/env node

const { execSync } = require('child_process');
const os = require('os');

const PORT = 3000;
const APP_NAME = 'Glide';

/**
 * @param {string} cmd
 */
function exec(cmd) {
    try {
        execSync(cmd, { stdio: 'inherit' });
        return true;
    } catch (error) {
        console.error(`Error: ${error.message}`);
        return false;
    }
}

/**
 * Open firewall port on Windows
 */
function openPortWindows() {
    console.log(`\n🔥 Opening port ${PORT} on Windows Firewall...`);

    const ruleName = `${APP_NAME}_${PORT}`;

    // Delete existing rule if any
    exec(`netsh advfirewall firewall delete rule name="${ruleName}"`);

    // Add new rule
    const success = exec(
        `netsh advfirewall firewall add rule name="${ruleName}" dir=in action=allow protocol=TCP localport=${PORT}`
    );

    if (success) {
        console.log(`✅ Port ${PORT} opened in Windows Firewall`);
    } else {
        console.error(`❌ Failed to open port. Run as Administrator!`);
    }
}

/**
 * Close firewall port on Windows
 */
function closePortWindows() {
    console.log(`\n🔥 Closing port ${PORT} on Windows Firewall...`);

    const ruleName = `${APP_NAME}_${PORT}`;
    const success = exec(`netsh advfirewall firewall delete rule name="${ruleName}"`);

    if (success) {
        console.log(`✅ Port ${PORT} rule removed from Windows Firewall`);
    }
}

/**
 * Setup macOS (no firewall config needed, just info)
 */
function setupMacOS() {
    console.log(`\n🍎 macOS detected`);
    console.log(`✅ macOS will prompt for network access automatically`);
    console.log(`   No firewall configuration needed`);
}

/**
 * Main
 */
function main() {
    const args = process.argv.slice(2);
    const command = args[0] || 'open';

    console.log(`\n🚀 ${APP_NAME} Firewall Setup`);
    console.log(`Platform: ${os.platform()}`);

    if (os.platform() === 'win32') {
        if (command === 'open') {
            openPortWindows();
        } else if (command === 'close') {
            closePortWindows();
        } else {
            console.log('Usage: node setup-firewall.js [open|close]');
        }
    } else if (os.platform() === 'darwin') {
        setupMacOS();
    } else {
        console.log('⚠️  Platform not supported');
    }
}

main();
