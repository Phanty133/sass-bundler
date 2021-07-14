# sass-bundler
A quick and dirty npm package for bundling page-specific SASS/SCSS.

## Usage
`@import` and `@use` statements in SASS must be preceeded by `!bundler`, e.g. `@use "!bundler/_partial.scss"`.

For the bundler to recognize partials, their filename must be preceeded by `_`.

Outputs partials used by all SASS files to a single file.

### Example

#### Input

`a.scss`
```
@use "!bundler/_partial1.scss"

#a{
  color: red;
}
```

`b.scss`
```
@use "!bundler/_partial1.scss"

#b{
  color: green;
}
```

`_partial1.scss`
```
span{
	font-weight: bold;
}
```

#### Compiles to

`a.css`
```
#a{
  color: red;
}
```

`b.css`
```
#b{
  color: green;
}
```

`shared.css`
```
span{
  font-weight: bold;
}
```

## CLI

### `sass-bundler [command] [options]` 

#### Commands:
* `help` - Print help
* `init` - Generate a default config file in current directory
* `build` - Build and bundle SASS/SCSS files. If sass-bundler.config.js isn't in the project root, uses default config.
* `watch` - Watch SASS/SCSS files for changes. If sass-bundler.config.js isn't in the project root, uses default config.

#### Options:
* `--config [string]` - Path to config file
* `--<CONFIG_ARG> [string]` - Overwrite config argument

## API

### `class Bundler(config?)`

* `.buildAll()` - Builds and bundles all SCSS/SASS files according to `config`
* `.watch()` - Watches files for changes. Incrementally compiles.

## Configuration

* `sassDir: [string]` - `./sass` - Path to the SASS/SCSS directory
* `outDir: [string]` - Default: `./build` - Path to the output directory
* `verbose: [boolean]` - Default: `false` - If true, prints which files have been compiled
* `sharedPath: [string]` - Default: `./build/shared.css` - Path to the file where to output the shared css