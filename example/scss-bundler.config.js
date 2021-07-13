const path = require("path");

const config = {
	verboseBuild: true,
	scssDir: path.join(__dirname, "scss"),
	outDir: path.join(__dirname, "dist"),
	commonPath: path.join(__dirname, "dist", "common.css")
}

module.exports = config;