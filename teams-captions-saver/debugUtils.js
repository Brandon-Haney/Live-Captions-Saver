// Debug utility for controlling log output
// Set DEBUG to false for production builds
const DEBUG = false;

const logger = {
    log: (...args) => {
        if (DEBUG) console.log(...args);
    },
    warn: (...args) => {
        console.warn(...args);
    },
    error: (...args) => {
        console.error(...args);
    },
    // Always log (for critical info)
    info: (...args) => {
        console.log(...args);
    }
};

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { logger, DEBUG };
}
