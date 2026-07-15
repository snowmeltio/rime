class TabInputWebview {}
class TabInputText {
    constructor(uri) {
        this.uri = uri;
    }
}

const vscode = {
    TabInputWebview,
    TabInputText,
    window: {
        tabGroups: {
            all: [],
        },
    },
};

module.exports = vscode;
