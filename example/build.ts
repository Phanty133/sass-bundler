import Bundler from "../src/index";

const bundler = new Bundler({
	scssDir: "./scss",
	outDir: "./dist",
	verbose: false,
	commonPath: "./dist/common.css",
});

bundler.watch();
