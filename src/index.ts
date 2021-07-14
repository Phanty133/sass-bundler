import sass from "sass";
import fse from "fs-extra";
import path from "path";
import { Readable, Writable } from "stream";
import chokidar from "chokidar";
import { performance } from "perf_hooks";
import defaultConfig from "./sass-bundler.config.js";

export interface Config{
	verbose?: boolean;
	sassDir?: string;
	outDir?: string;
	sharedPath?: string;
}

interface _Config{
	verbose: boolean;
	sassDir: string;
	outDir: string;
	sharedPath: string;
}

interface CompiledFile{
	imports: string[],
	filePath: string,
	readStream: Readable | null,
	writeStream: Writable | null,
	error?:boolean
}

let errorDetectedThisCycle = false;

/**
 * Handles all the processing for scss-bundler.
 */
export default class Bundler {
	config: _Config;
	compiledFiles: CompiledFile[] | null = null;
	commonImports: string[] | null = null;
	compilationError: boolean = false;

	/**
	 *
	 * @param {string} config scss-bundler configuration
	 */
	constructor(config?: Config) {
		this.config = Object.assign(defaultConfig, config);
	}

	/**
	 * Cleans the output directory.
	 */
	cleanDist() {
		fse.ensureDirSync(this.config.outDir);
		fse.emptyDirSync(this.config.outDir);
	}

	/**
	 * Compiles an .scss files without including bundler imports
	 * @param {string} filePath Path to the file to be compiled
	 * @return {CompiledFile} Imports and Read/Write stream for the compiled css
	 */
	compileSingle(filePath: string): CompiledFile {
		const output: CompiledFile = {
			imports: [],
			filePath,
			readStream: null,
			writeStream: null,
		};

		let result: sass.Result;

		try {
			result = sass.renderSync({
				file: filePath,
				importer: this.sassImporter(output),
			});
		} catch (err: any) {
			console.error(err.formatted);

			this.compilationError = true;
			output.error = true;
			return output;
		}

		const relativeCssPath = relativePath(filePath, this.config.sassDir).replace(/\.s[ca]ss$/, ".css");
		const absoluteCssPath = path.join(this.config.outDir, relativeCssPath);

		output.readStream = Readable.from(result.css);
		output.writeStream = fse.createWriteStream(absoluteCssPath);

		return output;
	}

	/**
	 * Compiles all .scss files in directory without including bundler imports
	 * @param {string} dirPath Path to directory
	 * @return {CompiledFile[]} Array of the compiled files
	 */
	compileDir(dirPath: string): CompiledFile[] {
		const output: CompiledFile[] = [];

		for (const file of fse.readdirSync(dirPath)) {
			if (file.startsWith("_")) continue; // Don't compile partials

			const compiled = this.compileSingle(path.join(dirPath, file));

			if (compiled !== null) {
				output.push(compiled);
			}
		}

		return output;
	}

	/**
	 * Checks if file `importFile` is an import shared for all files in `files`
	 * @param {string} importFile Relative (To scss directory) path to file
	 * @param {CompiledFile[]} files Compiled files array
	 * @return {boolean} Return true if is common file
	 */
	isCommonImport(
		importFile: string,
		files: CompiledFile[],
	): boolean {
		const imports = files.map((f) => f.imports);

		for (const importsArr of imports) {
			if (!importsArr.includes(importFile)) return false;
		}

		return true;
	}

	/**
	 * Finds all common imports
	 * @param {CompiledFile[]} files Compiled files
	 * @return {string[]} Array of common import paths relative to scss dir
	 */
	identifyCommonImports(files: CompiledFile[]): string[] {
		// Find file with lowest number of imports

		const filesCopy: CompiledFile[] = [...files];
		filesCopy.sort((a, b) => a.imports.length - b.imports.length);

		const checkImports: string[] = filesCopy[0].imports;

		// Filter for common imports

		return checkImports.filter((i) => this.isCommonImport(i, files));
	}

	/**
	 * Writes Compiled files and common imports
	 * @param {CompiledFile[]} files Compiled files
	 * @param {string[]} commonImports Array of common imports
	 */
	async bundle(
		files: CompiledFile[],
		commonImports: string[],
	): Promise<void> {
		for (const file of files) {
			await this.bundleSingle(file, commonImports);
		}
	}

	/**
	 * Bundle and write a single .css file
	 * @param {CompiledFile} file The file to be bundled
	 * @param {string[]} commonImports Common imports
	 */
	async bundleSingle(
		file: CompiledFile,
		commonImports: string[],
	) {
		let trimmedImports: string[] = [];

		if (file.imports) {
			trimmedImports = removeA(file.imports, ...commonImports);
		}

		if (trimmedImports.length > 0) {
			for (const scssImport of trimmedImports) {
				const importResult = sass.renderSync({
					file: scssImport,
				});

				await pipePromise(
					Readable.from(importResult.css),
					file.writeStream as Writable,
					false,
				);
			}
		}

		await pipePromise(
			file.readStream as Readable,
			file.writeStream as Writable,
		);

		if (this.config.verbose) {
			console.log(file.filePath);
		}
	}

	/**
	 * Writes all shared imports to a single file
	 * @param {string[]} commonImports Array of common imports
	 */
	async writeCommon(commonImports: string[]): Promise<void> {
		const writeStream = fse.createWriteStream(this.config.sharedPath);

		for (const commonImport of commonImports) {
			let result: sass.Result;

			try {
				result = sass.renderSync({
					file: commonImport,
				});
			} catch (err: any) {
				console.error(err.formatted);

				this.compilationError = true;
				return;
			}

			await pipePromise(
				Readable.from(result.css),
				writeStream,
				false,
			);
		}

		writeStream.end();

		if (this.config.verbose) {
			console.log(path.basename(this.config.sharedPath));
		}
	}

	/**
	 * Builds all files in scss directory
	 * @param {boolean} persist If 'True', saves the compilation
	 *                          result for use in incremental builds
	 */
	async buildAll(persist: boolean = false) {
		const time0 = performance.now();
		console.log("---------------");
		console.log("Bundling SCSS...");

		this.cleanDist();
		const files = this.compileDir(this.config.sassDir);

		if (this.compilationError) { // If this.compileDir set the error flag to true
			return;
		}

		const commonImports = this.identifyCommonImports(files);
		await this.bundle(files, commonImports);
		await this.writeCommon(commonImports);

		if (this.compilationError) { // If this.wruteCommon set the error flag to true
			return;
		}

		if (persist) {
			this.compiledFiles = files;
			this.commonImports = commonImports;
		}

		console.log(`SCSS bundled (${timeSince(time0)}ms)`);
		console.log("---------------");
	}

	/**
	 * Watch files for changes and update those affected
	 * @return {Promise<void>} Resolves after the first compilation
	 */
	watch(): Promise<void> {
		const watcher = chokidar.watch(this.config.sassDir);

		return new Promise<void>((res, rej) => {
			watcher.on("ready", async () => {
				await this.onChokidarReady(watcher);
				res();
			});
		});
	}

	/**
	 * Handler for when chokidar performs its initial scan
	 * @param {chokidar.FSWatcher} watcher The initialized watcher
	 */
	private async onChokidarReady(watcher: chokidar.FSWatcher) {
		await this.buildAll(true);

		watcher
			.on("all", async () => {
				if (!this.compilationError) return;
				if (errorDetectedThisCycle) {
					errorDetectedThisCycle = false;
					return;
				}

				this.compilationError = false;
				await this.buildAll(true);
			})
			.on("change", async (filePath: string) => {
				if (this.compilationError) return;
				await this.onFileChange(filePath);
			})
			.on("add", async (filePath: string) => {
				if (this.compilationError) return;
				await this.onFileAdd(filePath);
			})
			.on("unlink", async (filePath: string) => {
				if (this.compilationError) return;
				await this.onFileRemove(filePath);
			});

		console.log("Watching files...");
	}

	/**
	 * SCSS file change handler
	 * @param {string} filePath Path to the changed file
	 */
	private async onFileChange(filePath: string) {
		console.log("File changed!");
		const t0 = performance.now();

		if (this.commonImports === null || this.compiledFiles === null) {
			// eslint-disable-next-line max-len
			console.warn("Unable to handle \"change\" event: No common imports or compiled files have been persisted! Run .buildAll(true) first!");
			return;
		}

		if (path.basename(filePath).startsWith("_")) {
			if (this.commonImports.includes(filePath)) {
				await this.writeCommon(this.commonImports);

				console.log("Modified file was an in use shared partial. Shared file rebuilt (${})");
			} else {
				const affectedFiles = this.compiledFiles.filter((f) => f.imports.includes(filePath));

				await this.bundle(affectedFiles, this.commonImports);

				// eslint-disable-next-line max-len
				console.log(`Modified file was an in use non-shared partial. Affected files rebuilt (${timeSince(t0)}ms)`);

				return;
			}
		}

		const newFile = this.compileSingle(filePath);

		if (this.compilationError) { // If this.compileSingle set the error flag
			errorDetectedThisCycle = true;
			return;
		}

		const oldFile = this.compiledFiles.find((f) => f.filePath === filePath);

		if (!oldFile) {
			console.warn("Unable to handle \"change\" event: Previous compilation of the changed file not found!");
			return;
		}

		const oldFileIndex = this.compiledFiles.indexOf(oldFile);

		this.compiledFiles[oldFileIndex] = newFile; // Replace the old file

		if (equalsIgnoreOrder(newFile.imports, oldFile.imports)) {
			await this.bundleSingle(newFile, this.commonImports);
		} else {
			const removedImports = oldFile.imports.filter((i) => !newFile.imports.includes(i));
			const removedCommonImports = removedImports.filter((i) => this.commonImports!.includes(i));

			if (removedCommonImports.length > 0) {
				await this.buildAll(true);
				return;
			}

			const addedImports = newFile.imports.filter((i) => !oldFile.imports.includes(i));

			if (addedImports.length > 0) {
				const newCommonImports = this.identifyCommonImports(this.compiledFiles);

				if (!equalsIgnoreOrder(newCommonImports, this.commonImports)) {
					await this.buildAll(true);
					return;
				}
			}

			await this.bundleSingle(newFile, this.commonImports);
		}

		console.log(`File bundled (${timeSince(t0)}ms)`);
	}

	/**
	 * SCSS file add handler
	 * @param {string} filePath Path to the added file
	 */
	private async onFileAdd(filePath: string) {
		console.log("File added!");

		const t0 = performance.now();

		if (this.commonImports === null || this.compiledFiles === null) {
			// eslint-disable-next-line max-len
			console.warn("Unable to handle \"add\" event: No common imports or compiled files have been persisted! Run .buildAll(true) first!");
			return;
		}

		if (path.basename(filePath).startsWith("_")) {
			console.log("Added file was a partial. No action taken.");
			return;
		}

		const newFile = this.compileSingle(filePath);

		if (this.compilationError) { // If this.compileSingle set the error flag
			errorDetectedThisCycle = true;
			return;
		}

		this.compiledFiles.push(newFile);

		const missingCommonImports = this.commonImports.filter((i) => !newFile.imports.includes(i));

		if (missingCommonImports.length > 0) {
			await this.buildAll(true);
		} else {
			await this.bundleSingle(newFile, this.commonImports);
			console.log(`File bundled (${timeSince(t0)}ms)`);
		}
	}

	/**
	 * SCSS file unlink handler
	 * @param {string} filePath Path to the added file
	 */
	private async onFileRemove(filePath: string) {
		console.log("File removed!");
		const t0 = performance.now();

		if (this.commonImports === null || this.compiledFiles === null) {
			// eslint-disable-next-line max-len
			console.warn("Unable to handle \"add\" event: No common imports or compiled files have been persisted! Run .buildAll(true) first!");
			return;
		}

		// Different processing for partials
		if (path.basename(filePath).startsWith("_")) {
			const imports: Set<string> = new Set(this.compiledFiles.flatMap((f) => f.imports));
			const importPath = path.resolve(filePath);

			if (imports.has(importPath)) {
				if (this.commonImports.includes(importPath)) {
					this.commonImports.splice(this.commonImports.findIndex((i) => i === importPath), 1);

					console.error("Error: Removed file was an in use shared partial. Unable to recompile.");
					this.compilationError = true;
					errorDetectedThisCycle = true;

					return;
				} else {
					const affectedFiles = this.compiledFiles.filter((f) => f.imports.includes(importPath));

					this.compilationError = true;
					errorDetectedThisCycle = true;

					// eslint-disable-next-line max-len
					const errMsg = "Error: Removed file was an in use partial. Unable to recompile. \nPartial was used by:";
					// eslint-disable-next-line max-len
					const usedFilesMsg = affectedFiles.map((f) => f.filePath).reduce((acc, cur) => `${acc}\n - ${cur}`, " - ");

					console.error(`${errMsg}\n${usedFilesMsg}`);

					return;
				}
			} else {
				console.log("Removed file was an unused partial. No action taken.");
				return;
			}
		}

		const deletedFileIndex = this.compiledFiles.findIndex((f) => f.filePath === filePath);
		const deletedFile = this.compiledFiles[deletedFileIndex];
		const cssPath = (deletedFile.writeStream as fse.WriteStream).path;

		fse.unlinkSync(cssPath);

		this.compiledFiles.splice(deletedFileIndex, 1);

		const newCommonImports = this.identifyCommonImports(this.compiledFiles);

		if (!equalsIgnoreOrder(newCommonImports, this.commonImports)) {
			this.buildAll(true);
		} else {
			console.log(`Removed file processed (${timeSince(t0)}ms)`);
		}
	}

	/**
	 * Generates the bundler importer function for sass.render()
	 * @param {CompiledFile} fileOutput Reference to compiled file output
	 * @return {function(string): void} Importer function
	 */
	private sassImporter(fileOutput: CompiledFile): (url: string) => void {
		return (url: string) => {
			if (url.startsWith("!bundler")) {
				fileOutput.imports.push(path.resolve(this.config.sassDir, url.replace("!bundler", ".")));

				return { contents: "" };
			} else {
				return null;
			}
		};
	}
}

/**
 * Removes elements from array by value
 * @param {T[]} arr Source array
 * @param {...any} args Values to be removed
 * @return {T[]} Source array with values removed
 */
function removeA<T>(arr: T[], ...args: T[]): T[] {
	const arrCopy = [...arr];

	for (const arg of args) {
		const i = arrCopy.indexOf(arg, 0);

		if (i !== -1) {
			arrCopy.splice(i, 1);
		}
	}

	return arrCopy;
}

/**
 * Promisified Readable.pipe(dest, opt)
 * @param {Readable} read
 * @param {Writable} dest
 * @param {boolean} end
 * @return {Promise<void>}
 */
function pipePromise(
	read: Readable,
	dest: Writable,
	end: boolean = true,
): Promise<void> {
	return new Promise<void>((res, rej) => {
		read
			.pipe(dest, { end })
			.on("error", (err) => rej(err));

		if (end) {
			dest.on("finish", () => res());
		} else {
			read.on("end", () => res());
		}
	});
}

/**
 * Check if both arrays `a` and `b` have the same elements irrespective of order
 * @param {any[]} a
 * @param {any[]} b
 * @return {boolean}
 */
function equalsIgnoreOrder(a: any[], b: any[]): boolean {
	if (a.length !== b.length) return false;

	const uniqueValues = new Set([...a, ...b]);

	for (const v of uniqueValues) {
		const aCount = a.filter((e) => e === v).length;
		const bCount = b.filter((e) => e === v).length;

		if (aCount !== bCount) return false;
	}

	return true;
}

/**
 * Returns time since `t0` in milliseconds
 * @param {number} t0
 * @return {number}
 */
function timeSince(t0: number): number {
	return Math.round(performance.now() - t0);
}

/**
 * Returns path0 relative to path1
 * @param {string} path0
 * @param {string} path1
 * @return {string} Relative path
 */
function relativePath(path0: string, path1: string): string {
	return path.resolve(path0).replace(path.resolve(path1), "");
}
