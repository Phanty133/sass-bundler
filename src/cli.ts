#!/usr/bin/env node

import fse from "fs-extra";
import path from "path";
import pkgUp from "pkg-up";
import Bundler from "./index";
import * as defaultConfig from "./sass-bundler.config.js";

const DEFAULT_CONFIG_NAME = "sass-bundler.config.js";
const [,, ...args] = process.argv;

let mainCmd = "";
const cmdArgs: Record<string, string> = {};

for (let i = 0; i < args.length; i++) {
	if (args[i].startsWith("--")) {
		cmdArgs[args[i].substring(2)] = args[++i];
	} else {
		mainCmd = args[i];
	}
}

(async () => {
	const cwd: string = process.env.PWD as string;

	switch (mainCmd) {
		case "init":
			// eslint-disable-next-line max-len
			fse.copyFile(path.join(__dirname, "..", "src", DEFAULT_CONFIG_NAME), path.join(cwd, DEFAULT_CONFIG_NAME));
			break;
		case "help":
			console.log(
			// eslint-disable-next-line indent
`
sass-bundler [command] [options] 

Commands:
  help      Show this message
  init      Generate a default config file in current directory
  build     Build and bundle SASS/SCSS files. If sass-bundler.config.js isn't in the project root, uses default config.
  watch     Watch SASS/SCSS files for changes. If sass-bundler.config.js isn't in the project root, uses default config.

Options:
  --config [String]        Path to config file
  --<CONFIG_ARG> [String]  Overwrite config argument
`);
			break;
		case "build":
			execBundler(cwd, cmdArgs);
			break;
		case "watch":
			execBundler(cwd, cmdArgs, true);
			break;
		default:
			console.error("Error: Unknown command");
			break;
	}
})();

/**
 *
 * @param {string} cwd
 * @param {Record<string, string>} cmdArgs
 * @param {boolean} watch
 * @return {Promise<void>}
 */
async function execBundler(cwd: string, cmdArgs: Record<string, string>, watch: boolean = false): Promise<void> {
	const packageJsonPath = await pkgUp({ cwd });

	if (packageJsonPath === null) { // If unable to find package.json, just run with default config and args
		const bundler = new Bundler(Object.assign(defaultConfig, cmdArgs));

		if (watch) {
			bundler.watch();
		} else {
			bundler.buildAll();
		}

		return;
	}

	const projectRoot = path.dirname(packageJsonPath);
	const filesInRoot = await fse.readdir(projectRoot);

	if (Object.keys(cmdArgs).includes("config")) {
		const configPath = path.resolve(cwd, cmdArgs.config);

		if (fse.existsSync(configPath)) {
			const bundler = new Bundler(Object.assign(require(configPath), cmdArgs));

			if (watch) {
				bundler.watch();
			} else {
				bundler.buildAll();
			}
		} else {
			console.error(`Error: Path ${cmdArgs.config} doesn't exist!`);
		}
	} else if (filesInRoot.includes(DEFAULT_CONFIG_NAME)) {
		const configPath = path.join(projectRoot, DEFAULT_CONFIG_NAME);
		const bundler = new Bundler(Object.assign(require(configPath), cmdArgs));

		if (watch) {
			bundler.watch();
		} else {
			bundler.buildAll();
		}
	} else { // If no file found, run with default config and args
		const bundler = new Bundler(Object.assign(defaultConfig, cmdArgs));

		if (watch) {
			bundler.watch();
		} else {
			bundler.buildAll();
		}
	}
}
