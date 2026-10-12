// A browser bundle resolves the server entry to this module, so the loader never reaches a browser.
throw new Error('ACCESS_SERVER_ENTRY_IN_BROWSER: import @mpfrontend/access-react/server only from server code');
export {};
