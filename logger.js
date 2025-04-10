// logger.js
const isDev = process.env.NODE_ENV === 'dev';

const levels = {
    DEBUG: 'DEBUG',
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR',
};

const log = (message, level = levels.INFO, ...args) => {
    if (isDev || !isDev || level in [levels.ERROR, levels.INFO]) { // Always log errors, but only log in dev mode for others
        if(!args){
            console.log(`[${level}] ${message}`);
        }
        else{
            console.log(`[${level}] ${message}`, ...args);
        }
    }
};

const debug = (message, ...args) => {
    log(message, levels.DEBUG, ...args);
};

const info = (message, ...args) => {
    log(message, levels.INFO, ...args);
};

const warn = (message, ...args) => {
    log(message, levels.WARN, ...args);
};

const error = (message, ...args) => {
    log(message, levels.ERROR, ...args);
};

module.exports = {
    debug,
    info,
    warn,
    error,
};
