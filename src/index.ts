import sass from "sass";
import fse from "fs-extra";
import path from "path";
import { Readable, Writable } from "stream";
// import chokidar from "chokidar";
import { performance } from "perf_hooks";

interface Config{
	verbose: boolean;
	scssDir: string;
	outDir: string;
	commonPath: string;
}

interface CompiledFile{
	imports: string[],
	readStream: Readable | null,
	writeStream: Writable | null
}

/**
 * Handles all the processing for scss-bundler.
 */
export default class Bundler {
	config: Config;
	compiledFiles: Record<string, CompiledFile> = {};

	/**
	 *
	 * @param {string} config scss-bundler configuration
	 */
	constructor(config: Config) {
		this.config = config;
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
			readStream: null,
			writeStream: null,
		};

		const result = sass.renderSync({
			file: filePath,
			importer: this.sassImporter(output),
		});

		const relativeCssPath = path.resolve(filePath)
			.replace(path.resolve(this.config.scssDir), "")
			.replace(/\.s[ca]ss$/, ".css");

		const absoluteCssPath = path.join(this.config.outDir, relativeCssPath);

		output.readStream = Readable.from(result.css);
		output.writeStream = fse.createWriteStream(absoluteCssPath);

		return output;
	}

	/**
	 * Compiles all .scss files in directory without including bundler imports
	 * @param {string} dirPath path to directory
	 * @return {Record<string, CompiledFile>} { <FILE_PATH>: CompiledFile}
	 */
	compileDir(dirPath: string): Record<string, CompiledFile> {
		const output: Record<string, CompiledFile> = {};

		for (const file of fse.readdirSync(dirPath)) {
			if (file.startsWith("_")) continue; // Don't compile partials

			output[file] = this.compileSingle(path.join(dirPath, file));
		}

		return output;
	}

	/**
	 * Checks if file `importFile` is an import shared for all files in `files`
	 * @param {string} importFile Relative (To scss directory) path to file
	 * @param {Record<string, CompiledFile>} files Previously compiled files
	 * @return {boolean} Return true if is common file
	 */
	isCommonImport(
		importFile: string,
		files: Record<string, CompiledFile>,
	): boolean {
		const imports = Object.values(files).map((f) => f.imports);

		for (const importsArr of imports) {
			if (!importsArr.includes(importFile)) return false;
		}

		return true;
	}

	/**
	 * Finds all common imports
	 * @param {Record<string, CompiledFile>} files Compiled files
	 * @return {string[]} Array of common import paths relative to scss dir
	 */
	identifyCommonImports(files: Record<string, CompiledFile>): string[] {
		// Find file with lowest number of imports

		const fileValues: CompiledFile[] = Object.values(files);
		fileValues.sort((a, b) => a.imports.length - b.imports.length);

		const checkImports: string[] = fileValues[0].imports;

		// Filter for common imports

		return checkImports.filter((i) => this.isCommonImport(i, files));
	}

	/**
	 * Writes Compiled files and common imports
	 * @param {Record<string, CompiledFile>} files Compiled files
	 * @param {string[]} commonImports Array of common imports
	 */
	async bundle(
		files: Record<string, CompiledFile>,
		commonImports: string[],
	): Promise<void> {
		for (const file of Object.keys(files)) {
			if (files[file].imports) {
				files[file].imports = removeA(files[file].imports, ...commonImports);
			}

			if (files[file].imports?.length) {
				for (const scssImport of files[file].imports) {
					const importResult = sass.renderSync({
						file: path.join(this.config.scssDir, scssImport),
					});

					await pipePromise(
						Readable.from(importResult.css),
						files[file].writeStream as Writable,
						false,
					);
				}
			}

			await pipePromise(
				files[file].readStream as Readable,
				files[file].writeStream as Writable,
			);

			if (this.config.verbose) {
				console.log(file);
			}
		}

		await this.writeCommon(commonImports);
	}

	/**
	 * Writes all shared imports to a single file
	 * @param {string[]} commonImports Array of common imports
	 */
	async writeCommon(commonImports: string[]): Promise<void> {
		const writeStream = fse.createWriteStream(this.config.commonPath);

		for (const commonImport of commonImports) {
			const result = sass.renderSync({
				file: path.join(this.config.scssDir, commonImport),
			});

			await pipePromise(
				Readable.from(result.css),
				writeStream,
				false,
			);
		}

		writeStream.end();

		if (this.config.verbose) {
			console.log(path.basename(this.config.commonPath));
		}
	}

	/**
	 * Builds all files in scss directory
	 */
	async build() {
		const time0 = performance.now();
		console.log("---------------");
		console.log("Bundling SCSS...");

		this.cleanDist();
		const files = this.compileDir(this.config.scssDir);
		const commonImports = this.identifyCommonImports(files);
		await this.bundle(files, commonImports);

		console.log(`SCSS bundled (${Math.round(performance.now() - time0)}ms)`);
		console.log("---------------");
	}

	/**
	 * Generates the bundler importer function for sass.render()
	 * @param {CompiledFile} fileOutput Reference to compiled file output
	 * @return {function(string): void} Importer function
	 */
	private sassImporter(fileOutput: CompiledFile): (url: string) => void {
		return (url: string) => {
			if (url.startsWith("!bundler")) {
				fileOutput.imports.push(url.replace("!bundler", "."));

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
function removeA<T>(arr: T[], ...args: T[]) {
	let what; const a = args; let L = a.length; let ax;
	while (L > 1 && arr.length) {
		what = a[--L];
		while ((ax= arr.indexOf(what)) !== -1) {
			arr.splice(ax, 1);
		}
	}
	return arr;
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
