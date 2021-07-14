module.exports = {
	"env": {
		"browser": true,
		"es2021": true,
	},
	"extends": [
		"google",
	],
	"parser": "@typescript-eslint/parser",
	"parserOptions": {
		"ecmaVersion": 12,
		"sourceType": "module",
	},
	"plugins": [
		"@typescript-eslint",
	],
	"rules": {
		"indent": ["error", "tab", { "SwitchCase": 1 }],
		"quotes": ["error", "double"],
		"no-tabs": ["error", { "allowIndentationTabs": true }],
		"object-curly-spacing": ["error", "always"],
		"max-len": ["error", { "code": 120 }],
	},
};
