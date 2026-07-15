const Module = require('module');
const path = require('path');

const stubPath = path.join(__dirname, 'stubs', 'vscode.js');
const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function (request, ...args) {
    if (request === 'vscode') return stubPath;
    return originalResolveFilename.call(this, request, ...args);
};
