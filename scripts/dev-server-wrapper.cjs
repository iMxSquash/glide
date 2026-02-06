#!/usr/bin/env node

const { spawn, execSync } = require('child_process');
const path = require('path');

console.log('🔥 Opening firewall...');
try {
    execSync('npm run setup:firewall', { stdio: 'inherit' });
} catch (e) {
    console.log('⚠️  Could not open firewall (may need admin rights)');
}

console.log('\n🚀 Starting Glide server...\n');

const serverProcess = spawn('npm', ['run', 'dev:server:raw'], {
    stdio: 'inherit',
    shell: true,
    cwd: path.join(__dirname, '..')
});

function cleanup() {
    console.log('\n\n🔥 Closing firewall...');
    try {
        execSync('npm run remove:firewall', { stdio: 'inherit' });
    } catch (e) {
        console.log('⚠️  Could not close firewall');
    }
    process.exit(0);
}

process.on('SIGINT', () => {
    serverProcess.kill('SIGINT');
    setTimeout(cleanup, 500);
});

process.on('SIGTERM', () => {
    serverProcess.kill('SIGTERM');
    setTimeout(cleanup, 500);
});

serverProcess.on('exit', (code) => {
    cleanup();
});
