/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ 408:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const core = __nccwpck_require__(974);

const { run } = __nccwpck_require__(386);

/** @typedef {import('./github/context').GithubContext} GithubContext */

/**
 * Fetches and checks out the remote Git branch (if it exists, the fork repository will be used)
 * @param {GithubContext} context - Information about the GitHub
 */
function checkOutRemoteBranch(context) {
	if (context.repository.hasFork) {
		// Fork: Add fork repo as remote
		core.info(`Adding "${context.repository.forkName}" fork as remote with Git`);
		const cloneURl = new URL(context.repository.forkCloneUrl);
		cloneURl.username = context.actor;
		cloneURl.password = context.token;
		run(`git remote add fork ${cloneURl.toString()}`);
	} else {
		// No fork: Update remote URL to include auth information (so auto-fixes can be pushed)
		core.info(`Adding auth information to Git remote URL`);
		const cloneURl = new URL(context.repository.cloneUrl);
		cloneURl.username = context.actor;
		cloneURl.password = context.token;
		run(`git remote set-url origin ${cloneURl.toString()}`);
	}

	const remote = context.repository.hasFork ? "fork" : "origin";

	// Fetch remote branch
	core.info(`Fetching remote branch "${context.branch}"`);
	run(`git fetch --no-tags --depth=1 ${remote} ${context.branch}`);

	// Switch to remote branch
	core.info(`Switching to the "${context.branch}" branch`);
	run(`git branch --force ${context.branch} --track ${remote}/${context.branch}`);
	run(`git checkout ${context.branch}`);
}

/**
 * Stages and commits all changes using Git
 * @param {string} message - Git commit message
 * @param {boolean} skipVerification - Skip Git verification
 */
function commitChanges(message, skipVerification) {
	core.info(`Committing changes`);
	run(`git commit -am "${message}"${skipVerification ? " --no-verify" : ""}`);
}

/**
 * Returns the SHA of the head commit
 * @returns {string} - Head SHA
 */
function getHeadSha() {
	const sha = run("git rev-parse HEAD").stdout;
	core.info(`SHA of last commit is "${sha}"`);
	return sha;
}

/**
 * Checks whether there are differences from HEAD
 * @returns {boolean} - Boolean indicating whether changes exist
 */
function hasChanges() {
	const output = run("git diff-index --name-status --exit-code HEAD --", { ignoreErrors: true });
	const hasChangedFiles = output.status === 1;
	core.info(`${hasChangedFiles ? "Changes" : "No changes"} found with Git`);
	return hasChangedFiles;
}

/**
 * Pushes all changes to the remote repository
 * @param {boolean} skipVerification - Skip Git verification
 */
function pushChanges(skipVerification) {
	core.info("Pushing changes with Git");
	run(`git push${skipVerification ? " --no-verify" : ""}`);
}

/**
 * Updates the global Git configuration with the provided information
 * @param {string} name - Git username
 * @param {string} email - Git email address
 */
function setUserInfo(name, email) {
	core.info(`Setting Git user information`);
	run(`git config --global user.name "${name}"`);
	run(`git config --global user.email "${email}"`);
}

module.exports = {
	checkOutRemoteBranch,
	commitChanges,
	getHeadSha,
	hasChanges,
	pushChanges,
	setUserInfo,
};


/***/ }),

/***/ 364:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const core = __nccwpck_require__(974);

const { name: actionName } = __nccwpck_require__(598);
const request = __nccwpck_require__(758);
const { capitalizeFirstLetter } = __nccwpck_require__(659);

/** @typedef {import('./context').GithubContext} GithubContext */
/** @typedef {import('../utils/lint-result').LintResult} LintResult */

/**
 * Creates a new check on GitHub which annotates the relevant commit with linting errors
 * @param {string} linterName - Name of the linter for which a check should be created
 * @param {string} sha - SHA of the commit which should be annotated
 * @param {GithubContext} context - Information about the GitHub repository and
 * action trigger event
 * @param {LintResult} lintResult - Parsed lint result
 * @param {boolean} neutralCheckOnWarning - Whether the check run should conclude as neutral if
 * there are only warnings
 * @param {string} summary - Summary for the GitHub check
 */
async function createCheck(linterName, sha, context, lintResult, neutralCheckOnWarning, summary) {
	let annotations = [];
	for (const level of ["error", "warning"]) {
		annotations = [
			...annotations,
			...lintResult[level].map((result) => ({
				path: result.path,
				start_line: result.firstLine,
				end_line: result.lastLine,
				annotation_level: level === "warning" ? "warning" : "failure",
				message: result.message,
			})),
		];
	}

	// Only use the first 50 annotations (limit for a single API request)
	if (annotations.length > 50) {
		core.info(
			`There are more than 50 errors/warnings from ${linterName}. Annotations are created for the first 50 issues only.`,
		);
		annotations = annotations.slice(0, 50);
	}

	let conclusion;
	if (lintResult.isSuccess) {
		if (annotations.length > 0 && neutralCheckOnWarning) {
			conclusion = "neutral";
		} else {
			conclusion = "success";
		}
	} else {
		conclusion = "failure";
	}

	const body = {
		name: linterName,
		head_sha: sha,
		conclusion,
		output: {
			title: capitalizeFirstLetter(summary),
			summary: `${linterName} found ${summary}`,
			annotations,
		},
	};
	try {
		core.info(
			`Creating GitHub check with ${conclusion} conclusion and ${annotations.length} annotations for ${linterName}…`,
		);
		await request(`${process.env.GITHUB_API_URL}/repos/${context.repository.repoName}/check-runs`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				// "Accept" header is required to access Checks API during preview period
				Accept: "application/vnd.github.antiope-preview+json",
				Authorization: `Bearer ${context.token}`,
				"User-Agent": actionName,
			},
			body,
		});
		core.info(`${linterName} check created successfully`);
	} catch (err) {
		let errorMessage = err.message;
		if (err.data) {
			try {
				const errorData = JSON.parse(err.data);
				if (errorData.message) {
					errorMessage += `. ${errorData.message}`;
				}
				if (errorData.documentation_url) {
					errorMessage += ` ${errorData.documentation_url}`;
				}
			} catch (e) {
				// Ignore
			}
		}
		core.error(errorMessage);

		throw new Error(`Error trying to create GitHub check for ${linterName}: ${errorMessage}`);
	}
}

module.exports = { createCheck };


/***/ }),

/***/ 740:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const { readFileSync } = __nccwpck_require__(147);

const core = __nccwpck_require__(974);

const { name: actionName } = __nccwpck_require__(598);
const { getEnv } = __nccwpck_require__(386);

/**
 * GitHub Actions workflow's environment variables
 * @typedef ActionEnv
 * @property {string} actor Event actor.
 * @property {string} eventName Event name.
 * @property {string} eventPath Event path.
 * @property {string} token Token.
 * @property {string} workspace Workspace path.
 */

/**
 * Information about the GitHub repository and its fork (if it exists)
 * @typedef GithubRepository
 * @property {string} repoName Repo name.
 * @property {string} cloneUrl Repo clone URL.
 * @property {string} forkName Fork name.
 * @property {string} forkCloneUrl Fork repo clone URL.
 * @property {boolean} hasFork Whether repo has a fork.
 */

/**
 * Information about the GitHub repository and action trigger event
 * @typedef GithubContext
 * @property {string} actor Event actor.
 * @property {string} branch Branch name.
 * @property {object} event Event.
 * @property {string} eventName Event name.
 * @property {GithubRepository} repository Information about the GitHub repository
 * @property {string} token Token.
 * @property {string} workspace Workspace path.
 */

/**
 * Returns the GitHub Actions workflow's environment variables
 * @returns {ActionEnv} GitHub Actions workflow's environment variables
 */
function parseActionEnv() {
	return {
		// Information provided by environment
		actor: getEnv("github_actor", true),
		eventName: getEnv("github_event_name", true),
		eventPath: getEnv("github_event_path", true),
		workspace: getEnv("github_workspace", true),

		// Information provided by action user
		token: core.getInput("github_token", { required: true }),
	};
}

/**
 * Parse `event.json` file (file with the complete webhook event payload, automatically provided by
 * GitHub)
 * @param {string} eventPath - Path to the `event.json` file
 * @returns {object} - Webhook event payload
 */
function parseEnvFile(eventPath) {
	const eventBuffer = readFileSync(eventPath);
	return JSON.parse(eventBuffer);
}

/**
 * Parses the name of the current branch from the GitHub webhook event
 * @param {string} eventName - GitHub event type
 * @param {object} event - GitHub webhook event payload
 * @returns {string} - Branch name
 */
function parseBranch(eventName, event) {
	if (eventName === "push" || eventName === "workflow_dispatch") {
		return event.ref.substring(11); // Remove "refs/heads/" from start of string
	}
	if (eventName === "pull_request" || eventName === "pull_request_target") {
		return event.pull_request.head.ref;
	}
	throw Error(`${actionName} does not support "${eventName}" GitHub events`);
}

/**
 * Parses the name of the current repository and determines whether it has a corresponding fork.
 * Fork detection is only supported for the "pull_request" event
 * @param {string} eventName - GitHub event type
 * @param {object} event - GitHub webhook event payload
 * @returns {GithubRepository} - Information about the GitHub repository and its fork (if it exists)
 */
function parseRepository(eventName, event) {
	const repoName = event.repository.full_name;
	const cloneUrl = event.repository.clone_url;
	let forkName;
	let forkCloneUrl;
	if (eventName === "pull_request" || eventName === "pull_request_target") {
		// "pull_request" events are triggered on the repository where the PR is made. The PR branch can
		// be on the same repository (`forkRepository` is set to `null`) or on a fork (`forkRepository`
		// is defined)
		const headRepoName = event.pull_request.head.repo.full_name;
		forkName = repoName === headRepoName ? undefined : headRepoName;
		const headForkCloneUrl = event.pull_request.head.repo.clone_url;
		forkCloneUrl = cloneUrl === headForkCloneUrl ? undefined : headForkCloneUrl;
	}
	return {
		repoName,
		cloneUrl,
		forkName,
		forkCloneUrl,
		hasFork: forkName != null && forkName !== repoName,
	};
}

/**
 * Returns information about the GitHub repository and action trigger event
 * @returns {GithubContext} context - Information about the GitHub repository and action trigger
 * event
 */
function getContext() {
	const { actor, eventName, eventPath, token, workspace } = parseActionEnv();
	const event = parseEnvFile(eventPath);
	return {
		actor,
		branch: parseBranch(eventName, event),
		event,
		eventName,
		repository: parseRepository(eventName, event),
		token,
		workspace,
	};
}

module.exports = {
	getContext,
	parseActionEnv,
	parseBranch,
	parseEnvFile,
	parseRepository,
};


/***/ }),

/***/ 723:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const { run } = __nccwpck_require__(386);
const commandExists = __nccwpck_require__(525);
const { parseErrorsFromDiff } = __nccwpck_require__(984);
const { initLintResult } = __nccwpck_require__(314);

/** @typedef {import('../utils/lint-result').LintResult} LintResult */

/**
 * https://github.com/hhatto/autopep8
 */
class Autopep8 {
	static get name() {
		return "Autopep8";
	}

	/**
	 * Verifies that all required programs are installed. Throws an error if programs are missing
	 * @param {string} dir - Directory to run the linting program in
	 * @param {string} prefix - Prefix to the lint command
	 */
	static async verifySetup(dir, prefix = "") {
		// Verify that Python is installed (required to execute Autopep8)
		if (!(await commandExists("python"))) {
			throw new Error("Python is not installed");
		}

		// Verify that Autopep8 is installed
		try {
			run(`${prefix} autopep8 --version`, { dir });
		} catch (err) {
			throw new Error(`${this.name} is not installed`);
		}
	}

	/**
	 * Runs the linting program and returns the command output
	 * @param {string} dir - Directory to run the linter in
	 * @param {string[]} extensions - File extensions which should be linted
	 * @param {string} args - Additional arguments to pass to the linter
	 * @param {boolean} fix - Whether the linter should attempt to fix code style issues automatically
	 * @param {string} prefix - Prefix to the lint command
	 * @returns {{status: number, stdout: string, stderr: string}} - Output of the lint command
	 */
	static lint(dir, extensions, args = "", fix = false, prefix = "") {
		if (extensions.length !== 1 || extensions[0] !== "py") {
			throw new Error(`${this.name} error: File extensions are not configurable`);
		}
		const fixArg = fix ? "-i" : "-d --exit-code";
		const output = run(`${prefix} autopep8 ${fixArg} ${args} -r "."`, {
			dir,
			ignoreErrors: true,
		});

		// Slashes can be different depending on OS
		output.stdout = output.stdout.replace(/^(---|\+\+\+) (original|fixed)\/\.[\\/]/gm, "$1 ");

		return output;
	}

	/**
	 * Parses the output of the lint command. Determines the success of the lint process and the
	 * severity of the identified code style violations
	 * @param {string} dir - Directory in which the linter has been run
	 * @param {{status: number, stdout: string, stderr: string}} output - Output of the lint command
	 * @returns {LintResult} - Parsed lint result
	 */
	static parseOutput(dir, output) {
		const lintResult = initLintResult();
		lintResult.error = parseErrorsFromDiff(output.stdout);
		lintResult.isSuccess = output.status === 0;
		return lintResult;
	}
}

module.exports = Autopep8;


/***/ }),

/***/ 774:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const { run } = __nccwpck_require__(386);
const commandExists = __nccwpck_require__(525);
const { parseErrorsFromDiff } = __nccwpck_require__(984);
const { initLintResult } = __nccwpck_require__(314);

/** @typedef {import('../utils/lint-result').LintResult} LintResult */

/**
 * https://black.readthedocs.io
 */
class Black {
	static get name() {
		return "Black";
	}

	/**
	 * Verifies that all required programs are installed. Throws an error if programs are missing
	 * @param {string} dir - Directory to run the linting program in
	 * @param {string} prefix - Prefix to the lint command
	 */
	static async verifySetup(dir, prefix = "") {
		// Verify that Python is installed (required to execute Black)
		if (!(await commandExists("python"))) {
			throw new Error("Python is not installed");
		}

		// Verify that Black is installed
		try {
			run(`${prefix} black --version`, { dir });
		} catch (err) {
			throw new Error(`${this.name} is not installed`);
		}
	}

	/**
	 * Runs the linting program and returns the command output
	 * @param {string} dir - Directory to run the linter in
	 * @param {string[]} extensions - File extensions which should be linted
	 * @param {string} args - Additional arguments to pass to the linter
	 * @param {boolean} fix - Whether the linter should attempt to fix code style issues automatically
	 * @param {string} prefix - Prefix to the lint command
	 * @returns {{status: number, stdout: string, stderr: string}} - Output of the lint command
	 */
	static lint(dir, extensions, args = "", fix = false, prefix = "") {
		const files = `^.*\\.(${extensions.join("|")})$`;
		const fixArg = fix ? "" : "--check --diff";
		return run(`${prefix} black ${fixArg} --include "${files}" ${args} "."`, {
			dir,
			ignoreErrors: true,
		});
	}

	/**
	 * Parses the output of the lint command. Determines the success of the lint process and the
	 * severity of the identified code style violations
	 * @param {string} dir - Directory in which the linter has been run
	 * @param {{status: number, stdout: string, stderr: string}} output - Output of the lint command
	 * @returns {LintResult} - Parsed lint result
	 */
	static parseOutput(dir, output) {
		const lintResult = initLintResult();
		lintResult.error = parseErrorsFromDiff(output.stdout);
		lintResult.isSuccess = output.status === 0;
		return lintResult;
	}
}

module.exports = Black;


/***/ }),

/***/ 156:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const glob = __nccwpck_require__(531);
const { quoteAll } = __nccwpck_require__(867);

const { run } = __nccwpck_require__(386);
const commandExists = __nccwpck_require__(525);
const { initLintResult } = __nccwpck_require__(314);

/** @typedef {import('../utils/lint-result').LintResult} LintResult */

/**
 * https://clang.llvm.org/docs/ClangFormat.html
 */
class ClangFormat {
	static get name() {
		return "clang_format";
	}

	/**
	 * Verifies that all required programs are installed. Throws an error if programs are missing
	 * @param {string} dir - Directory to run the linting program in
	 * @param {string} prefix - Prefix to the lint command
	 */
	static async verifySetup(dir, prefix = "") {
		if (!(await commandExists("clang-format"))) {
			throw new Error("clang-format is not installed");
		}
	}

	/**
	 * Runs the linting program and returns the command output
	 * @param {string} dir - Directory to run the linter in
	 * @param {string[]} extensions - File extensions which should be linted
	 * @param {string} args - Additional arguments to pass to the linter
	 * @param {boolean} fix - Whether the linter should attempt to fix code style issues automatically
	 * @param {string} prefix - Prefix to the lint command
	 * @returns {{status: number, stdout: string, stderr: string}} - Output of the lint command
	 */
	static lint(dir, extensions, args = "", fix = false, prefix = "") {
		const pattern =
			extensions.length === 1 ? `**/*.${extensions[0]}` : `**/*.{${extensions.join(",")}}`;
		const files = glob.sync(pattern, { cwd: dir, nodir: true });
		const escapedFiles = quoteAll(files).join(" ");
		const fixArg = fix ? "-i" : "--dry-run";
		return run(`${prefix} clang-format ${fixArg} -Werror ${args} ${escapedFiles}`, {
			dir,
			ignoreErrors: true,
		});
	}

	/**
	 * Parses the output of the lint command. Determines the success of the lint process and the
	 * severity of the identified code style violations
	 * @param {string} dir - Directory in which the linter has been run
	 * @param {{status: number, stdout: string, stderr: string}} output - Output of the lint command
	 * @returns {LintResult} - Parsed lint result
	 */
	static parseOutput(dir, output) {
		const lintResult = initLintResult();
		lintResult.isSuccess = output.status === 0;
		if (lintResult.isSuccess || !output) {
			return lintResult;
		}

		const lines = output.stderr.split(/\r?\n/);
		lintResult.error = lines.flatMap((line) => {
			const matched = line.match(/^(.*):(\d+):\d+: error: (.*)$/);
			if (!matched) {
				return [];
			}
			const lineNumber = parseInt(matched.at(2), 10);
			return {
				path: matched.at(1),
				firstLine: lineNumber,
				lastLine: lineNumber,
				message: matched.at(3),
			};
		});

		return lintResult;
	}
}

module.exports = ClangFormat;


/***/ }),

/***/ 165:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const { run } = __nccwpck_require__(386);
const commandExists = __nccwpck_require__(525);
const { initLintResult } = __nccwpck_require__(314);

/** @typedef {import('../utils/lint-result').LintResult} LintResult */

/**
 * https://rust-lang.github.io/rust-clippy/
 */
class Clippy {
	static get name() {
		return "clippy";
	}

	/**
	 * Verifies that all required programs are installed. Throws an error if programs are missing
	 * @param {string} dir - Directory to run the linting program in
	 * @param {string} prefix - Prefix to the lint command
	 */
	static async verifySetup(dir, prefix = "") {
		// Verify that cargo is installed (required to execute clippy)
		if (!(await commandExists("cargo"))) {
			throw new Error("cargo is not installed");
		}

		// Verify that clippy is installed
		try {
			run(`${prefix} cargo clippy --version`, { dir });
		} catch (err) {
			throw new Error(`${this.name} is not installed`);
		}
	}

	/**
	 * Runs the linting program and returns the command output
	 * @param {string} dir - Directory to run the linter in
	 * @param {string[]} extensions - File extensions which should be linted
	 * @param {string} args - Additional arguments to pass to the linter
	 * @param {boolean} fix - Whether the linter should attempt to fix code style issues automatically
	 * @param {string} prefix - Prefix to the lint command
	 * @returns {{status: number, stdout: string, stderr: string}} - Output of the lint command
	 */
	static lint(dir, extensions, args = "", fix = false, prefix = "") {
		if (extensions.length !== 1 || extensions[0] !== "rs") {
			throw new Error(`${this.name} error: File extensions are not configurable`);
		}

		// clippy will throw an error if `--allow-dirty` is used when `--fix` isn't.
		// in order to have tests run consistently and to help out users we remove `--allow-dirty`
		// when not in fix
		const localArgs = fix ? args : args.replace("--allow-dirty", "");

		const fixArg = fix ? "--fix" : "";
		return run(`${prefix} cargo clippy ${fixArg} --message-format json ${localArgs}`, {
			dir,
			ignoreErrors: true,
		});
	}

	/**
	 * Parses the output of the lint command. Determines the success of the lint process and the
	 * severity of the identified code style violations
	 * @param {string} dir - Directory in which the linter has been run
	 * @param {{status: number, stdout: string, stderr: string}} output - Output of the lint command
	 * @returns {LintResult} - Parsed lint result
	 */
	static parseOutput(dir, output) {
		const lintResult = initLintResult();

		const lines = output.stdout.split("\n").map((line) => {
			let parsedLine;
			try {
				let normalizedLine = line;
				if (process.platform === "win32") {
					normalizedLine = line.replace(/\\/gi, "\\\\");
				}
				parsedLine = JSON.parse(normalizedLine);
			} catch (err) {
				throw Error(
					`Error parsing ${this.name} JSON output: ${err.message}. Output: "${output.stdout}"`,
				);
			}
			return parsedLine;
		});

		lines.forEach((line) => {
			if (line.reason === "compiler-message") {
				if (line.message.level === "warning") {
					const { code, message, spans } = line.message;
					// don't add the message counting the warnings
					if (code !== null) {
						lintResult.warning.push({
							path: spans[0].file_name,
							firstLine: spans[0].line_start,
							lastLine: spans[0].line_end,
							message,
						});
					}
				} else if (line.message.level === "error") {
					const { code, message, spans } = line.message;
					// don't add the message counting the errors
					if (code !== null) {
						lintResult.warning.push({
							path: spans[0].file_name,
							firstLine: spans[0].line_start,
							lastLine: spans[0].line_end,
							message,
						});
					}
				}
			}
		});

		lintResult.isSuccess =
			output.status === 0 && lintResult.warning.length === 0 && lintResult.error.length === 0;

		return lintResult;
	}
}

module.exports = Clippy;


/***/ }),

/***/ 839:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const { run } = __nccwpck_require__(386);
const commandExists = __nccwpck_require__(525);
const { initLintResult } = __nccwpck_require__(314);

const PARSE_REGEX = /^(.*)\(([0-9]+),([0-9]+)\): (warning|error) (.*) \[.*$/gm;

/** @typedef {import('../utils/lint-result').LintResult} LintResult */

/**
 * https://github.com/dotnet/format
 */
class DotnetFormat {
	static get name() {
		return "dotnet_format";
	}

	/**
	 * Verifies that all required programs are installed. Throws an error if programs are missing
	 * @param {string} dir - Directory to run the linting program in
	 * @param {string} prefix - Prefix to the lint command
	 */
	static async verifySetup(dir, prefix = "") {
		// Verify that dotnet is installed (required to execute dotnet format)
		if (!(await commandExists("dotnet"))) {
			throw new Error(".NET SDK is not installed");
		}

		// Verify that dotnet-format is installed
		try {
			run(`${prefix} dotnet format --version`, { dir });
		} catch (err) {
			throw new Error(`${this.name} is not installed`);
		}
	}

	/**
	 * Runs the linting program and returns the command output
	 * @param {string} dir - Directory to run the linter in
	 * @param {string[]} extensions - File extensions which should be linted
	 * @param {string} args - Additional arguments to pass to the linter
	 * @param {boolean} fix - Whether the linter should attempt to fix code style issues automatically
	 * @param {string} prefix - Prefix to the lint command
	 * @returns {{status: number, stdout: string, stderr: string}} - Output of the lint command
	 */
	static lint(dir, extensions, args = "", fix = false, prefix = "") {
		if (extensions.length !== 1 || extensions[0] !== "cs") {
			throw new Error(`${this.name} error: File extensions are not configurable`);
		}

		const fixArg = fix ? "" : "--verify-no-changes";
		return run(`${prefix} dotnet format ${fixArg} ${args}`, {
			dir,
			ignoreErrors: true,
		});
	}

	/**
	 * Parses the output of the lint command. Determines the success of the lint process and the
	 * severity of the identified code style violations
	 * @param {string} dir - Directory in which the linter has been run
	 * @param {{status: number, stdout: string, stderr: string}} output - Output of the lint command
	 * @returns {LintResult} - Parsed lint result
	 */
	static parseOutput(dir, output) {
		const lintResult = initLintResult();
		lintResult.isSuccess = output.status === 0;

		const matches = output.stderr.matchAll(PARSE_REGEX);
		for (const match of matches) {
			const [_line, pathFull, line, _column, level, message] = match;
			const path = pathFull.substring(dir.length + 1);
			const lineNr = parseInt(line, 10);
			lintResult[level].push({
				path,
				firstLine: lineNr,
				lastLine: lineNr,
				message: `${message}`,
			});
		}

		return lintResult;
	}
}

module.exports = DotnetFormat;


/***/ }),

/***/ 690:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const core = __nccwpck_require__(974);

const { run } = __nccwpck_require__(386);
const commandExists = __nccwpck_require__(525);
const { initLintResult } = __nccwpck_require__(314);
const { removeTrailingPeriod } = __nccwpck_require__(659);

/** @typedef {import('../utils/lint-result').LintResult} LintResult */

/**
 * https://https://github.com/Shopify/erb-lint
 */
class Erblint {
	static get name() {
		return "ERB Lint";
	}

	/**
	 * Verifies that all required programs are installed. Throws an error if programs are missing
	 * @param {string} dir - Directory to run the linting program in
	 * @param {string} prefix - Prefix to the lint command
	 */
	static async verifySetup(dir, prefix = "") {
		// Verify that Ruby is installed (required to execute erblint)
		if (!(await commandExists("ruby"))) {
			throw new Error("Ruby is not installed");
		}
		// Verify that erblint is installed
		try {
			run(`${prefix} erblint -v`, { dir });
		} catch (err) {
			throw new Error(`${this.name} is not installed`);
		}
	}

	/**
	 * Runs the linting program and returns the command output
	 * @param {string} dir - Directory to run the linter in
	 * @param {string[]} extensions - File extensions which should be linted
	 * @param {string} args - Additional arguments to pass to the linter
	 * @param {boolean} fix - Whether the linter should attempt to fix code style issues automatically
	 * @param {string} prefix - Prefix to the lint command
	 * @returns {{status: number, stdout: string, stderr: string}} - Output of the lint command
	 */
	static lint(dir, extensions, args = "", fix = false, prefix = "") {
		if (extensions.length !== 1 || extensions[0] !== "erb") {
			throw new Error(`${this.name} error: File extensions are not configurable`);
		}
		if (fix) {
			core.warning(`${this.name} does not support auto-fixing`);
		}

		return run(`${prefix} erblint --format json --lint-all ${args}`, {
			dir,
			ignoreErrors: true,
		});
	}

	/**
	 * Parses the output of the lint command. Determines the success of the lint process and the
	 * severity of the identified code style violations
	 * @param {string} dir - Directory in which the linter has been run
	 * @param {{status: number, stdout: string, stderr: string}} output - Output of the lint command
	 * @returns {LintResult} - Parsed lint result
	 */
	static parseOutput(dir, output) {
		const lintResult = initLintResult();
		lintResult.isSuccess = output.status === 0;

		let outputJson;
		try {
			outputJson = JSON.parse(output.stdout);
		} catch (err) {
			throw Error(
				`Error parsing ${this.name} JSON output: ${err.message}. Output: "${output.stdout}"`,
			);
		}

		for (const file of outputJson.files) {
			const { path, offenses } = file;
			for (const offense of offenses) {
				const { message, linter, corrected, location } = offense;
				if (!corrected) {
					// ERB Lint does not provide severities in its JSON output
					lintResult.error.push({
						path,
						firstLine: location.start_line,
						lastLine: location.last_line,
						message: `${removeTrailingPeriod(message)} (${linter})`,
					});
				}
			}
		}

		return lintResult;
	}
}

module.exports = Erblint;


/***/ }),

/***/ 22:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const { run } = __nccwpck_require__(386);
const commandExists = __nccwpck_require__(525);
const { initLintResult } = __nccwpck_require__(314);
const { getNpmBinCommand } = __nccwpck_require__(148);
const { removeTrailingPeriod } = __nccwpck_require__(659);

/** @typedef {import('../utils/lint-result').LintResult} LintResult */

/**
 * https://eslint.org
 */
class ESLint {
	static get name() {
		return "ESLint";
	}

	/**
	 * Verifies that all required programs are installed. Throws an error if programs are missing
	 * @param {string} dir - Directory to run the linting program in
	 * @param {string} prefix - Prefix to the lint command
	 */
	static async verifySetup(dir, prefix = "") {
		// Verify that NPM is installed (required to execute ESLint)
		if (!(await commandExists("npm"))) {
			throw new Error("NPM is not installed");
		}

		// Verify that ESLint is installed
		const commandPrefix = prefix || getNpmBinCommand(dir);
		try {
			run(`${commandPrefix} eslint -v`, { dir });
		} catch (err) {
			throw new Error(`${this.name} is not installed`);
		}
	}

	/**
	 * Runs the linting program and returns the command output
	 * @param {string} dir - Directory to run the linter in
	 * @param {string[]} extensions - File extensions which should be linted
	 * @param {string} args - Additional arguments to pass to the linter
	 * @param {boolean} fix - Whether the linter should attempt to fix code style issues automatically
	 * @param {string} prefix - Prefix to the lint command
	 * @returns {{status: number, stdout: string, stderr: string}} - Output of the lint command
	 */
	static lint(dir, extensions, args = "", fix = false, prefix = "") {
		const extensionsArg = extensions.map((ext) => `.${ext}`).join(",");
		const fixArg = fix ? "--fix" : "";
		const commandPrefix = prefix || getNpmBinCommand(dir);
		return run(
			`${commandPrefix} eslint --ext ${extensionsArg} ${fixArg} --no-color --format json ${args} "."`,
			{
				dir,
				ignoreErrors: true,
			},
		);
	}

	/**
	 * Parses the output of the lint command. Determines the success of the lint process and the
	 * severity of the identified code style violations
	 * @param {string} dir - Directory in which the linter has been run
	 * @param {{status: number, stdout: string, stderr: string}} output - Output of the lint command
	 * @returns {LintResult} - Parsed lint result
	 */
	static parseOutput(dir, output) {
		const lintResult = initLintResult();
		lintResult.isSuccess = output.status === 0;

		let outputJson;
		try {
			outputJson = JSON.parse(output.stdout);
		} catch (err) {
			throw Error(
				`Error parsing ${this.name} JSON output: ${err.message}. Output: "${output.stdout}"`,
			);
		}

		for (const violation of outputJson) {
			const { filePath, messages } = violation;
			const path = filePath.substring(dir.length + 1);

			for (const msg of messages) {
				const { fatal, line, message, ruleId, severity } = msg;

				// Exit if a fatal ESLint error occurred
				if (fatal) {
					throw Error(`ESLint error: ${message}`);
				}

				const entry = {
					path,
					firstLine: line,
					lastLine: line,
					message: `${removeTrailingPeriod(message)} (${ruleId})`,
				};
				if (severity === 1) {
					lintResult.warning.push(entry);
				} else if (severity === 2) {
					lintResult.error.push(entry);
				}
			}
		}

		return lintResult;
	}
}

module.exports = ESLint;


/***/ }),

/***/ 87:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const { sep } = __nccwpck_require__(17);

const core = __nccwpck_require__(974);

const { run } = __nccwpck_require__(386);
const commandExists = __nccwpck_require__(525);
const { initLintResult } = __nccwpck_require__(314);
const { capitalizeFirstLetter } = __nccwpck_require__(659);

const PARSE_REGEX = /^(.*):([0-9]+):[0-9]+: (\w*) (.*)$/gm;

/** @typedef {import('../utils/lint-result').LintResult} LintResult */

/**
 * http://flake8.pycqa.org
 */
class Flake8 {
	static get name() {
		return "Flake8";
	}

	/**
	 * Verifies that all required programs are installed. Throws an error if programs are missing
	 * @param {string} dir - Directory to run the linting program in
	 * @param {string} prefix - Prefix to the lint command
	 */
	static async verifySetup(dir, prefix = "") {
		// Verify that Python is installed (required to execute Flake8)
		if (!(await commandExists("python"))) {
			throw new Error("Python is not installed");
		}

		// Verify that Flake8 is installed
		try {
			run(`${prefix} flake8 --version`, { dir });
		} catch (err) {
			throw new Error(`${this.name} is not installed`);
		}
	}

	/**
	 * Runs the linting program and returns the command output
	 * @param {string} dir - Directory to run the linter in
	 * @param {string[]} extensions - File extensions which should be linted
	 * @param {string} args - Additional arguments to pass to the linter
	 * @param {boolean} fix - Whether the linter should attempt to fix code style issues automatically
	 * @param {string} prefix - Prefix to the lint command
	 * @returns {{status: number, stdout: string, stderr: string}} - Output of the lint command
	 */
	static lint(dir, extensions, args = "", fix = false, prefix = "") {
		if (fix) {
			core.warning(`${this.name} does not support auto-fixing`);
		}

		const files = extensions.map((ext) => `"**${sep}*.${ext}"`).join(",");
		return run(`${prefix} flake8 --filename ${files} ${args}`, {
			dir,
			ignoreErrors: true,
		});
	}

	/**
	 * Parses the output of the lint command. Determines the success of the lint process and the
	 * severity of the identified code style violations
	 * @param {string} dir - Directory in which the linter has been run
	 * @param {{status: number, stdout: string, stderr: string}} output - Output of the lint command
	 * @returns {LintResult} - Parsed lint result
	 */
	static parseOutput(dir, output) {
		const lintResult = initLintResult();
		lintResult.isSuccess = output.status === 0;

		const matches = output.stdout.matchAll(PARSE_REGEX);
		for (const match of matches) {
			const [_, pathFull, line, rule, text] = match;
			const leadingSep = `.${sep}`;
			let path = pathFull;
			if (path.startsWith(leadingSep)) {
				path = path.substring(2); // Remove "./" or ".\" from start of path
			}
			const lineNr = parseInt(line, 10);
			lintResult.error.push({
				path,
				firstLine: lineNr,
				lastLine: lineNr,
				message: `${capitalizeFirstLetter(text)} (${rule})`,
			});
		}

		return lintResult;
	}
}

module.exports = Flake8;


/***/ }),

/***/ 268:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const { run } = __nccwpck_require__(386);
const commandExists = __nccwpck_require__(525);
const { parseErrorsFromDiff } = __nccwpck_require__(984);
const { initLintResult } = __nccwpck_require__(314);

/** @typedef {import('../utils/lint-result').LintResult} LintResult */

/**
 * https://golang.org/cmd/gofmt
 */
class Gofmt {
	static get name() {
		return "gofmt";
	}

	/**
	 * Verifies that all required programs are installed. Throws an error if programs are missing
	 * @param {string} dir - Directory to run the linting program in
	 * @param {string} prefix - Prefix to the lint command
	 */
	static async verifySetup(dir, prefix = "") {
		// Verify that gofmt is installed
		if (!(await commandExists("gofmt"))) {
			throw new Error(`${this.name} is not installed`);
		}
	}

	/**
	 * Runs the linting program and returns the command output
	 * @param {string} dir - Directory to run the linter in
	 * @param {string[]} extensions - File extensions which should be linted
	 * @param {string} args - Additional arguments to pass to the linter
	 * @param {boolean} fix - Whether the linter should attempt to fix code style issues automatically
	 * @param {string} prefix - Prefix to the lint command
	 * @returns {{status: number, stdout: string, stderr: string}} - Output of the lint command
	 */
	static lint(dir, extensions, args = "", fix = false, prefix = "") {
		if (extensions.length !== 1 || extensions[0] !== "go") {
			throw new Error(`${this.name} error: File extensions are not configurable`);
		}

		// -d: Display diffs instead of rewriting files
		// -e: Report all errors (not just the first 10 on different lines)
		// -s: Simplify code
		// -w: Write result to (source) file instead of stdout
		const fixArg = fix ? "-w" : "-d -e";
		return run(`${prefix} gofmt -s ${fixArg} ${args} "."`, {
			dir,
			ignoreErrors: true,
		});
	}

	/**
	 * Parses the output of the lint command. Determines the success of the lint process and the
	 * severity of the identified code style violations
	 * @param {string} dir - Directory in which the linter has been run
	 * @param {{status: number, stdout: string, stderr: string}} output - Output of the lint command
	 * @returns {LintResult} - Parsed lint result
	 */
	static parseOutput(dir, output) {
		const lintResult = initLintResult();

		// The gofmt output lines starting with "diff" differ from the ones of tools like Git:
		//
		//   - gofmt: "diff -u file-old.txt file-new.txt"
		//   - Git: "diff --git a/file-old.txt b/file-new.txt"
		//
		// The diff parser relies on the "a/" and "b/" strings to be able to tell where file names
		// start. Without these strings, this would not be possible, because file names may include
		// spaces, which are not escaped in unified diffs. As a workaround, these lines are filtered out
		// from the gofmt diff so the diff parser can read the diff without errors
		const filteredOutput = output.stdout
			.split(/\r?\n/)
			.filter((line) => !line.startsWith("diff "))
			.join("\n");
		lintResult.error = parseErrorsFromDiff(filteredOutput);

		// gofmt exits with 0 even if there are formatting issues. Therefore, this function determines
		// the success of the linting process based on the number of parsed errors
		lintResult.isSuccess = lintResult.error.length === 0;

		return lintResult;
	}
}

module.exports = Gofmt;


/***/ }),

/***/ 703:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const core = __nccwpck_require__(974);

const { run } = __nccwpck_require__(386);
const commandExists = __nccwpck_require__(525);
const { initLintResult } = __nccwpck_require__(314);
const { capitalizeFirstLetter } = __nccwpck_require__(659);

const PARSE_REGEX = /^(.+):([0-9]+):[0-9]+: (.+)$/gm;

/** @typedef {import('../utils/lint-result').LintResult} LintResult */

/**
 * https://github.com/golang/lint
 */
class Golint {
	static get name() {
		return "golint";
	}

	/**
	 * Verifies that all required programs are installed. Throws an error if programs are missing
	 * @param {string} dir - Directory to run the linting program in
	 * @param {string} prefix - Prefix to the lint command
	 */
	static async verifySetup(dir, prefix = "") {
		// Verify that golint is installed
		if (!(await commandExists("golint"))) {
			throw new Error(`${this.name} is not installed`);
		}
	}

	/**
	 * Runs the linting program and returns the command output
	 * @param {string} dir - Directory to run the linter in
	 * @param {string[]} extensions - File extensions which should be linted
	 * @param {string} args - Additional arguments to pass to the linter
	 * @param {boolean} fix - Whether the linter should attempt to fix code style issues automatically
	 * @param {string} prefix - Prefix to the lint command
	 * @returns {{status: number, stdout: string, stderr: string}} - Output of the lint command
	 */
	static lint(dir, extensions, args = "", fix = false, prefix = "") {
		if (extensions.length !== 1 || extensions[0] !== "go") {
			throw new Error(`${this.name} error: File extensions are not configurable`);
		}
		if (fix) {
			core.warning(`${this.name} does not support auto-fixing`);
		}

		return run(`${prefix} golint -set_exit_status ${args} "."`, {
			dir,
			ignoreErrors: true,
		});
	}

	/**
	 * Parses the output of the lint command. Determines the success of the lint process and the
	 * severity of the identified code style violations
	 * @param {string} dir - Directory in which the linter has been run
	 * @param {{status: number, stdout: string, stderr: string}} output - Output of the lint command
	 * @returns {LintResult} - Parsed lint result
	 */
	static parseOutput(dir, output) {
		const lintResult = initLintResult();
		lintResult.isSuccess = output.status === 0;

		const matches = output.stdout.matchAll(PARSE_REGEX);
		for (const match of matches) {
			const [_, path, line, text] = match;
			const lineNr = parseInt(line, 10);
			lintResult.error.push({
				path,
				firstLine: lineNr,
				lastLine: lineNr,
				message: capitalizeFirstLetter(text),
			});
		}

		return lintResult;
	}
}

module.exports = Golint;


/***/ }),

/***/ 727:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const Autopep8 = __nccwpck_require__(723);
const Black = __nccwpck_require__(774);
const ClangFormat = __nccwpck_require__(156);
const Clippy = __nccwpck_require__(165);
const DotnetFormat = __nccwpck_require__(839);
const Erblint = __nccwpck_require__(690);
const ESLint = __nccwpck_require__(22);
const Flake8 = __nccwpck_require__(87);
const Gofmt = __nccwpck_require__(268);
const Golint = __nccwpck_require__(703);
const Mypy = __nccwpck_require__(596);
const Oitnb = __nccwpck_require__(175);
const PHPCodeSniffer = __nccwpck_require__(805);
const Prettier = __nccwpck_require__(609);
const Pylint = __nccwpck_require__(567);
const RuboCop = __nccwpck_require__(38);
const RustFmt = __nccwpck_require__(281);
const Stylelint = __nccwpck_require__(722);
const SwiftFormatLockwood = __nccwpck_require__(712);
const SwiftFormatOfficial = __nccwpck_require__(879);
const SwiftLint = __nccwpck_require__(370);
const TSC = __nccwpck_require__(503);
const XO = __nccwpck_require__(638);

const linters = {
	// Linters
	clippy: Clippy,
	erblint: Erblint,
	eslint: ESLint,
	flake8: Flake8,
	golint: Golint,
	mypy: Mypy,
	php_codesniffer: PHPCodeSniffer,
	pylint: Pylint,
	rubocop: RuboCop,
	stylelint: Stylelint,
	swiftlint: SwiftLint,
	xo: XO,
	tsc: TSC,

	// Formatters (should be run after linters)
	autopep8: Autopep8,
	black: Black,
	clang_format: ClangFormat,
	dotnet_format: DotnetFormat,
	gofmt: Gofmt,
	oitnb: Oitnb,
	rustfmt: RustFmt,
	prettier: Prettier,
	swift_format_lockwood: SwiftFormatLockwood,
	swift_format_official: SwiftFormatOfficial,

	// Alias of `swift_format_lockwood` (for backward compatibility)
	// TODO: Remove alias in v2
	swiftformat: SwiftFormatLockwood,
};

module.exports = linters;


/***/ }),

/***/ 596:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const fs = __nccwpck_require__(147);
const { sep } = __nccwpck_require__(17);

const core = __nccwpck_require__(974);

const { run } = __nccwpck_require__(386);
const commandExists = __nccwpck_require__(525);
const { initLintResult } = __nccwpck_require__(314);

const PARSE_REGEX = /^(.*):([0-9]+): (\w*): (.*)$/gm;

/** @typedef {import('../utils/lint-result').LintResult} LintResult */

/**
 * https://mypy.readthedocs.io/en/stable/
 */
class Mypy {
	static get name() {
		return "Mypy";
	}

	/**
	 * Verifies that all required programs are installed. Throws an error if programs are missing
	 * @param {string} dir - Directory to run the linting program in
	 * @param {string} prefix - Prefix to the lint command
	 */
	static async verifySetup(dir, prefix = "") {
		// Verify that Python is installed (required to execute Mypy)
		if (!(await commandExists("python"))) {
			throw new Error("Python is not installed");
		}

		// Verify that Mypy is installed
		try {
			run(`${prefix} mypy --version`, { dir });
		} catch (err) {
			throw new Error(`${this.name} is not installed`);
		}
	}

	/**
	 * Runs the linting program and returns the command output
	 * @param {string} dir - Directory to run the linter in
	 * @param {string[]} extensions - File extensions which should be linted
	 * @param {string} args - Additional arguments to pass to the linter
	 * @param {boolean} fix - Whether the linter should attempt to fix code style issues automatically
	 * @param {string} prefix - Prefix to the lint command
	 * @returns {{status: number, stdout: string, stderr: string}} - Output of the lint command
	 */
	static lint(dir, extensions, args = "", fix = false, prefix = "") {
		if (extensions.length !== 1 || extensions[0] !== "py") {
			throw new Error(`${this.name} error: File extensions are not configurable`);
		}
		if (fix) {
			core.warning(`${this.name} does not support auto-fixing`);
		}

		let specifiedPath = false;
		// Check if they passed a directory as an arg
		for (const arg of args.split(" ")) {
			if (fs.existsSync(arg)) {
				specifiedPath = true;
				break;
			}
		}
		let extraArgs = "";
		if (!specifiedPath) {
			extraArgs = ` ${dir}`;
		}
		return run(`${prefix} mypy ${args}${extraArgs}`, {
			dir,
			ignoreErrors: true,
		});
	}

	/**
	 * Parses the output of the lint command. Determines the success of the lint process and the
	 * severity of the identified code style violations
	 * @param {string} dir - Directory in which the linter has been run
	 * @param {{status: number, stdout: string, stderr: string}} output - Output of the lint command
	 * @returns {LintResult} - Parsed lint result
	 */
	static parseOutput(dir, output) {
		const lintResult = initLintResult();
		lintResult.isSuccess = output.status === 0;

		const matches = output.stdout.matchAll(PARSE_REGEX);
		for (const match of matches) {
			const [_, pathFull, line, level, text] = match;
			const leadingSep = `.${sep}`;
			let path = pathFull;
			if (path.startsWith(leadingSep)) {
				path = path.substring(2); // Remove "./" or ".\" from start of path
			}
			const lineNr = parseInt(line, 10);
			const result = {
				path,
				firstLine: lineNr,
				lastLine: lineNr,
				message: text,
			};
			if (level === "error") {
				lintResult.error.push(result);
			} else if (level === "warning") {
				lintResult.warning.push(result);
			}
		}

		return lintResult;
	}
}

module.exports = Mypy;


/***/ }),

/***/ 175:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const { run } = __nccwpck_require__(386);
const commandExists = __nccwpck_require__(525);
const { parseErrorsFromDiff } = __nccwpck_require__(984);
const { initLintResult } = __nccwpck_require__(314);

/** @typedef {import('../utils/lint-result').LintResult} LintResult */

/**
 * https://pypi.org/project/oitnb/
 */
class Oitnb {
	static get name() {
		return "oitnb";
	}

	/**
	 * Verifies that all required programs are installed. Throws an error if programs are missing
	 * @param {string} dir - Directory to run the linting program in
	 * @param {string} prefix - Prefix to the lint command
	 */
	static async verifySetup(dir, prefix = "") {
		// Verify that Python is installed (required to execute oitnb)
		if (!(await commandExists("python"))) {
			throw new Error("Python is not installed");
		}

		// Verify that oitnb is installed
		try {
			run(`${prefix} oitnb --version`, { dir });
		} catch (err) {
			throw new Error(`${this.name} is not installed`);
		}
	}

	/**
	 * Runs the linting program and returns the command output
	 * @param {string} dir - Directory to run the linter in
	 * @param {string[]} extensions - File extensions which should be linted
	 * @param {string} args - Additional arguments to pass to the linter
	 * @param {boolean} fix - Whether the linter should attempt to fix code style issues automatically
	 * @param {string} prefix - Prefix to the lint command
	 * @returns {{status: number, stdout: string, stderr: string}} - Output of the lint command
	 */
	static lint(dir, extensions, args = "", fix = false, prefix = "") {
		const files = `^.*\\.(${extensions.join("|")})$`;
		const fixArg = fix ? "" : "--check --diff";
		return run(`${prefix} oitnb ${fixArg} --include "${files}" ${args} "."`, {
			dir,
			ignoreErrors: true,
		});
	}

	/**
	 * Parses the output of the lint command. Determines the success of the lint process and the
	 * severity of the identified code style violations
	 * @param {string} dir - Directory in which the linter has been run
	 * @param {{status: number, stdout: string, stderr: string}} output - Output of the lint command
	 * @returns {LintResult} - Parsed lint result
	 */
	static parseOutput(dir, output) {
		const lintResult = initLintResult();
		lintResult.error = parseErrorsFromDiff(output.stdout);
		lintResult.isSuccess = output.status === 0;
		return lintResult;
	}
}

module.exports = Oitnb;


/***/ }),

/***/ 805:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const core = __nccwpck_require__(974);

const { run } = __nccwpck_require__(386);
const commandExists = __nccwpck_require__(525);
const { initLintResult } = __nccwpck_require__(314);
const { removeTrailingPeriod } = __nccwpck_require__(659);

/** @typedef {import('../utils/lint-result').LintResult} LintResult */

/**
 * https://github.com/squizlabs/PHP_CodeSniffer
 */
class PHPCodeSniffer {
	static get name() {
		return "PHP_CodeSniffer";
	}

	/**
	 * Verifies that all required programs are installed. Throws an error if programs are missing
	 * @param {string} dir - Directory to run the linting program in
	 * @param {string} prefix - Prefix to the lint command
	 */
	static async verifySetup(dir, prefix = "") {
		// Verify that PHP is installed (required to execute phpcs)
		if (!(await commandExists("php"))) {
			throw new Error("PHP is not installed");
		}

		// Verify that phpcs is installed
		try {
			run(`${prefix} phpcs --version`, { dir });
		} catch (err) {
			throw new Error(`${this.name} is not installed`);
		}
	}

	/**
	 * Runs the linting program and returns the command output
	 * @param {string} dir - Directory to run the linter in
	 * @param {string[]} extensions - File extensions which should be linted
	 * @param {string} args - Additional arguments to pass to the linter
	 * @param {boolean} fix - Whether the linter should attempt to fix code style issues automatically
	 * @param {string} prefix - Prefix to the lint command
	 * @returns {{status: number, stdout: string, stderr: string}} - Output of the lint command
	 */
	static lint(dir, extensions, args = "", fix = false, prefix = "") {
		const extensionsArg = extensions.join(",");
		if (fix) {
			core.warning(`${this.name} does not support auto-fixing`);
		}

		return run(`${prefix} phpcs --extensions=${extensionsArg} --report=json -q ${args} "."`, {
			dir,
			ignoreErrors: true,
		});
	}

	/**
	 * Parses the output of the lint command. Determines the success of the lint process and the
	 * severity of the identified code style violations
	 * @param {string} dir - Directory in which the linter has been run
	 * @param {{status: number, stdout: string, stderr: string}} output - Output of the lint command
	 * @returns {LintResult} - Parsed lint result
	 */
	static parseOutput(dir, output) {
		const lintResult = initLintResult();
		lintResult.isSuccess = output.status === 0;

		let outputJson;
		try {
			outputJson = JSON.parse(output.stdout);
		} catch (err) {
			throw Error(
				`Error parsing ${this.name} JSON output: ${err.message}. Output: "${output.stdout}"`,
			);
		}

		for (const [file, violations] of Object.entries(outputJson.files)) {
			const path = file.indexOf(dir) === 0 ? file.substring(dir.length + 1) : file;

			for (const msg of violations.messages) {
				const { line, message, source, type } = msg;

				const entry = {
					path,
					firstLine: line,
					lastLine: line,
					message: `${removeTrailingPeriod(message)} (${source})`,
				};
				if (type === "WARNING") {
					lintResult.warning.push(entry);
				} else if (type === "ERROR") {
					lintResult.error.push(entry);
				}
			}
		}

		return lintResult;
	}
}

module.exports = PHPCodeSniffer;


/***/ }),

/***/ 609:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const { run } = __nccwpck_require__(386);
const commandExists = __nccwpck_require__(525);
const { initLintResult } = __nccwpck_require__(314);
const { getNpmBinCommand } = __nccwpck_require__(148);

/** @typedef {import('../utils/lint-result').LintResult} LintResult */

/**
 * https://prettier.io
 */
class Prettier {
	static get name() {
		return "Prettier";
	}

	/**
	 * Verifies that all required programs are installed. Throws an error if programs are missing
	 * @param {string} dir - Directory to run the linting program in
	 * @param {string} prefix - Prefix to the lint command
	 */
	static async verifySetup(dir, prefix = "") {
		// Verify that NPM is installed (required to execute Prettier)
		if (!(await commandExists("npm"))) {
			throw new Error("NPM is not installed");
		}

		// Verify that Prettier is installed
		const commandPrefix = prefix || getNpmBinCommand(dir);
		try {
			run(`${commandPrefix} prettier -v`, { dir });
		} catch (err) {
			throw new Error(`${this.name} is not installed`);
		}
	}

	/**
	 * Runs the linting program and returns the command output
	 * @param {string} dir - Directory to run the linter in
	 * @param {string[]} extensions - File extensions which should be linted
	 * @param {string} args - Additional arguments to pass to the linter
	 * @param {boolean} fix - Whether the linter should attempt to fix code style issues automatically
	 * @param {string} prefix - Prefix to the lint command
	 * @returns {{status: number, stdout: string, stderr: string}} - Output of the lint command
	 */
	static lint(dir, extensions, args = "", fix = false, prefix = "") {
		const files =
			extensions.length === 1 ? `**/*.${extensions[0]}` : `**/*.{${extensions.join(",")}}`;
		const fixArg = fix ? "--write" : "--list-different";
		const commandPrefix = prefix || getNpmBinCommand(dir);
		return run(`${commandPrefix} prettier ${fixArg} --no-color ${args} "${files}"`, {
			dir,
			ignoreErrors: true,
		});
	}

	/**
	 * Parses the output of the lint command. Determines the success of the lint process and the
	 * severity of the identified code style violations
	 * @param {string} dir - Directory in which the linter has been run
	 * @param {{status: number, stdout: string, stderr: string}} output - Output of the lint command
	 * @returns {LintResult} - Parsed lint result
	 */
	static parseOutput(dir, output) {
		const lintResult = initLintResult();
		lintResult.isSuccess = output.status === 0;
		if (lintResult.isSuccess || !output) {
			return lintResult;
		}

		const paths = output.stdout.split(/\r?\n/);
		lintResult.error = paths.map((path) => ({
			path,
			firstLine: 1,
			lastLine: 1,
			message:
				"There are issues with this file's formatting, please run Prettier to fix the errors",
		}));

		return lintResult;
	}
}

module.exports = Prettier;


/***/ }),

/***/ 567:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const { sep } = __nccwpck_require__(17);

const core = __nccwpck_require__(974);

const { run } = __nccwpck_require__(386);
const commandExists = __nccwpck_require__(525);
const { initLintResult } = __nccwpck_require__(314);
const { capitalizeFirstLetter } = __nccwpck_require__(659);

const PARSE_REGEX = /^(.*):([0-9]+):[0-9]+: (\w*): (.*) (.*)$/gm;

/** @typedef {import('../utils/lint-result').LintResult} LintResult */

/*
 https://pylint.pycqa.org
 */
class Pylint {
	static get name() {
		return "Pylint";
	}

	/**
	 * Verifies that all required programs are installed. Throws an error if programs are missing
	 * @param {string} dir - Directory to run the linting program in
	 * @param {string} prefix - Prefix to the lint command
	 */
	static async verifySetup(dir, prefix = "") {
		// Verify that Python is installed (required to execute Pylint)
		if (!(await commandExists("python"))) {
			throw new Error("Python is not installed");
		}

		// Verify that Pylint is installed
		try {
			run(`${prefix} pylint --version`, { dir });
		} catch (err) {
			throw new Error(`${this.name} is not installed`);
		}
	}

	/**
	 * Runs the linting program and returns the command output
	 * @param {string} dir - Directory to run the linter in
	 * @param {string[]} extensions - File extensions which should be linted
	 * @param {string} args - Additional arguments to pass to the linter
	 * @param {boolean} fix - Whether the linter should attempt to fix code style issues automatically
	 * @param {string} prefix - Prefix to the lint command
	 * @returns {{status: number, stdout: string, stderr: string}} - Output of the lint command
	 */
	static lint(dir, extensions, args = "", fix = false, prefix = "") {
		if (extensions.length !== 1 || extensions[0] !== "py") {
			throw new Error(`${this.name} error: File extensions are not configurable`);
		}
		if (fix) {
			core.warning(`${this.name} does not support auto-fixing`);
		}

		return run(`${prefix} pylint --recursive=y "." ${args}`, {
			dir,
			ignoreErrors: true,
		});
	}

	/**
	 * Parses the output of the lint command. Determines the success of the lint process and the
	 * severity of the identified code style violations
	 * @param {string} dir - Directory in which the linter has been run
	 * @param {{status: number, stdout: string, stderr: string}} output - Output of the lint command
	 * @returns {LintResult} - Parsed lint result
	 */
	static parseOutput(dir, output) {
		const lintResult = initLintResult();
		lintResult.isSuccess = output.status === 0;

		const matches = output.stdout.matchAll(PARSE_REGEX);
		for (const match of matches) {
			const [_, pathFull, line, ruleId, text, rule] = match;
			const leadingSep = `.${sep}`;
			let path = pathFull;
			if (path.startsWith(leadingSep)) {
				path = path.substring(2); // Remove "./" or ".\" from start of path
			}
			const lineNr = parseInt(line, 10);
			lintResult.error.push({
				path,
				firstLine: lineNr,
				lastLine: lineNr,
				message: `${capitalizeFirstLetter(text)} (${rule.replace(/[)(]/g, "")}, ${ruleId})`,
			});
		}

		return lintResult;
	}
}

module.exports = Pylint;


/***/ }),

/***/ 38:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const { run } = __nccwpck_require__(386);
const commandExists = __nccwpck_require__(525);
const { initLintResult } = __nccwpck_require__(314);
const { removeTrailingPeriod } = __nccwpck_require__(659);

/** @typedef {import('../utils/lint-result').LintResult} LintResult */

// Mapping of RuboCop severities to severities used for GitHub commit annotations
const severityMap = {
	convention: "warning",
	refactor: "warning",
	warning: "warning",
	error: "error",
	fatal: "error",
};

/**
 * https://rubocop.readthedocs.io
 */
class RuboCop {
	static get name() {
		return "RuboCop";
	}

	/**
	 * Verifies that all required programs are installed. Throws an error if programs are missing
	 * @param {string} dir - Directory to run the linting program in
	 * @param {string} prefix - Prefix to the lint command
	 */
	static async verifySetup(dir, prefix = "") {
		// Verify that Ruby is installed (required to execute RuboCop)
		if (!(await commandExists("ruby"))) {
			throw new Error("Ruby is not installed");
		}
		// Verify that RuboCop is installed
		try {
			run(`${prefix} rubocop -v`, { dir });
		} catch (err) {
			throw new Error(`${this.name} is not installed`);
		}
	}

	/**
	 * Runs the linting program and returns the command output
	 * @param {string} dir - Directory to run the linter in
	 * @param {string[]} extensions - File extensions which should be linted
	 * @param {string} args - Additional arguments to pass to the linter
	 * @param {boolean} fix - Whether the linter should attempt to fix code style issues automatically
	 * @param {string} prefix - Prefix to the lint command
	 * @returns {{status: number, stdout: string, stderr: string}} - Output of the lint command
	 */
	static lint(dir, extensions, args = "", fix = false, prefix = "") {
		if (extensions.length !== 1 || extensions[0] !== "rb") {
			throw new Error(`${this.name} error: File extensions are not configurable`);
		}

		const fixArg = fix ? "--auto-correct" : "";
		return run(`${prefix} rubocop --format json ${fixArg} ${args}`, {
			dir,
			ignoreErrors: true,
		});
	}

	/**
	 * Parses the output of the lint command. Determines the success of the lint process and the
	 * severity of the identified code style violations
	 * @param {string} dir - Directory in which the linter has been run
	 * @param {{status: number, stdout: string, stderr: string}} output - Output of the lint command
	 * @returns {LintResult} - Parsed lint result
	 */
	static parseOutput(dir, output) {
		const lintResult = initLintResult();
		lintResult.isSuccess = output.status === 0;

		let outputJson;
		try {
			outputJson = JSON.parse(output.stdout);
		} catch (err) {
			throw Error(
				`Error parsing ${this.name} JSON output: ${err.message}. Output: "${output.stdout}"`,
			);
		}

		for (const file of outputJson.files) {
			const { path, offenses } = file;
			for (const offense of offenses) {
				const { severity, message, cop_name: rule, corrected, location } = offense;
				if (!corrected) {
					const mappedSeverity = severityMap[severity] || "error";
					lintResult[mappedSeverity].push({
						path,
						firstLine: location.start_line,
						lastLine: location.last_line,
						message: `${removeTrailingPeriod(message)} (${rule})`,
					});
				}
			}
		}

		return lintResult;
	}
}

module.exports = RuboCop;


/***/ }),

/***/ 281:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const { run } = __nccwpck_require__(386);
const commandExists = __nccwpck_require__(525);
const { initLintResult } = __nccwpck_require__(314);

/** @typedef {import('../utils/lint-result').LintResult} LintResult */

const PARSE_REGEX = /([\s\S]*?) at line (\d*):$([\s\S]*)/m;

/**
 * https://github.com/rust-lang/rustfmt
 */
class RustFmt {
	static get name() {
		return "rustfmt";
	}

	/**
	 * Verifies that all required programs are installed. Throws an error if programs are missing
	 * @param {string} dir - Directory to run the linting program in
	 * @param {string} prefix - Prefix to the lint command
	 */
	static async verifySetup(dir, prefix = "") {
		// Verify that cargo format is installed
		if (!(await commandExists("cargo-fmt"))) {
			throw new Error("Cargo format is not installed");
		}
	}

	/**
	 * Runs the linting program and returns the command output
	 * @param {string} dir - Directory to run the linter in
	 * @param {string[]} extensions - File extensions which should be linted
	 * @param {string} args - Additional arguments to pass to the linter
	 * @param {boolean} fix - Whether the linter should attempt to fix code style issues automatically
	 * @param {string} prefix - Prefix to the lint command
	 * @returns {{status: number, stdout: string, stderr: string}} - Output of the lint command
	 */
	static lint(dir, extensions, args = "-- --color=never", fix = false, prefix = "") {
		if (extensions.length !== 1 || extensions[0] !== "rs") {
			throw new Error(`${this.name} error: File extensions are not configurable`);
		}
		const fixArg = fix ? "" : "--check";
		return run(`${prefix} cargo fmt ${fixArg} ${args}`, {
			dir,
			ignoreErrors: true,
		});
	}

	/**
	 * Parses the output of the lint command. Determines the success of the lint process and the
	 * severity of the identified code style violations
	 * @param {string} dir - Directory in which the linter has been run
	 * @param {{status: number, stdout: string, stderr: string}} output - Output of the lint command
	 * @returns {LintResult} - Parsed lint result
	 */
	static parseOutput(dir, output) {
		const lintResult = initLintResult();
		lintResult.isSuccess = output.status === 0;
		if (!output.stdout) {
			return lintResult;
		}

		const diffs = output.stdout.split(/^Diff in /gm).slice(1);
		for (const diff of diffs) {
			const [_, pathFull, line, message] = diff.match(PARSE_REGEX);
			// Split on dir works for windows UNC paths, the substring strips out the
			// left over '/' or '\\'
			const path = pathFull.split(dir)[1].substring(1);
			const lineNr = parseInt(line, 10);
			lintResult.error.push({
				path,
				firstLine: lineNr,
				lastLine: lineNr,
				message,
			});
		}

		return lintResult;
	}
}

module.exports = RustFmt;


/***/ }),

/***/ 722:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const { run } = __nccwpck_require__(386);
const commandExists = __nccwpck_require__(525);
const { initLintResult } = __nccwpck_require__(314);
const { getNpmBinCommand } = __nccwpck_require__(148);

/** @typedef {import('../utils/lint-result').LintResult} LintResult */

/**
 * https://stylelint.io
 */
class Stylelint {
	static get name() {
		return "stylelint";
	}

	/**
	 * Verifies that all required programs are installed. Throws an error if programs are missing
	 * @param {string} dir - Directory to run the linting program in
	 * @param {string} prefix - Prefix to the lint command
	 */
	static async verifySetup(dir, prefix = "") {
		// Verify that NPM is installed (required to execute stylelint)
		if (!(await commandExists("npm"))) {
			throw new Error("NPM is not installed");
		}

		// Verify that stylelint is installed
		const commandPrefix = prefix || getNpmBinCommand(dir);
		try {
			run(`${commandPrefix} stylelint -v`, { dir });
		} catch (err) {
			throw new Error(`${this.name} is not installed`);
		}
	}

	/**
	 * Runs the linting program and returns the command output
	 * @param {string} dir - Directory to run the linter in
	 * @param {string[]} extensions - File extensions which should be linted
	 * @param {string} args - Additional arguments to pass to the linter
	 * @param {boolean} fix - Whether the linter should attempt to fix code style issues automatically
	 * @param {string} prefix - Prefix to the lint command
	 * @returns {{status: number, stdout: string, stderr: string}} - Output of the lint command
	 */
	static lint(dir, extensions, args = "", fix = false, prefix = "") {
		const files =
			extensions.length === 1 ? `**/*.${extensions[0]}` : `**/*.{${extensions.join(",")}}`;
		const fixArg = fix ? "--fix" : "";
		const commandPrefix = prefix || getNpmBinCommand(dir);
		return run(
			`${commandPrefix} stylelint --no-color --formatter json ${fixArg} ${args} "${files}"`,
			{
				dir,
				ignoreErrors: true,
			},
		);
	}

	/**
	 * Parses the output of the lint command. Determines the success of the lint process and the
	 * severity of the identified code style violations
	 * @param {string} dir - Directory in which the linter has been run
	 * @param {{status: number, stdout: string, stderr: string}} output - Output of the lint command
	 * @returns {LintResult} - Parsed lint result
	 */
	static parseOutput(dir, output) {
		const lintResult = initLintResult();
		lintResult.isSuccess = output.status === 0;

		let outputJson;
		try {
			outputJson = JSON.parse(output.stdout);
		} catch (err) {
			throw Error(
				`Error parsing ${this.name} JSON output: ${err.message}. Output: "${output.stdout}"`,
			);
		}

		for (const violation of outputJson) {
			const { source, warnings } = violation;
			const path = source.substring(dir.length + 1);
			for (const warning of warnings) {
				const { line, severity, text } = warning;
				if (severity in lintResult) {
					lintResult[severity].push({
						path,
						firstLine: line,
						lastLine: line,
						message: text,
					});
				}
			}
		}

		return lintResult;
	}
}

module.exports = Stylelint;


/***/ }),

/***/ 712:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const { run } = __nccwpck_require__(386);
const commandExists = __nccwpck_require__(525);
const { initLintResult } = __nccwpck_require__(314);

const PARSE_REGEX = /^(.*):([0-9]+):[0-9]+: \w+: \((\w+)\) (.*)\.$/gm;

/** @typedef {import('../utils/lint-result').LintResult} LintResult */

/**
 * https://github.com/nicklockwood/SwiftFormat
 */
class SwiftFormatLockwood {
	static get name() {
		return "SwiftFormat";
	}

	/**
	 * Verifies that all required programs are installed. Throws an error if programs are missing
	 * @param {string} dir - Directory to run the linting program in
	 * @param {string} prefix - Prefix to the lint command
	 */
	static async verifySetup(dir, prefix = "") {
		// Verify that SwiftFormat is installed
		if (!(await commandExists("swiftformat"))) {
			throw new Error(`${this.name} is not installed`);
		}
	}

	/**
	 * Runs the linting program and returns the command output
	 * @param {string} dir - Directory to run the linter in
	 * @param {string[]} extensions - File extensions which should be linted
	 * @param {string} args - Additional arguments to pass to the linter
	 * @param {boolean} fix - Whether the linter should attempt to fix code style issues automatically
	 * @param {string} prefix - Prefix to the lint command
	 * @returns {{status: number, stdout: string, stderr: string}} - Output of the lint command
	 */
	static lint(dir, extensions, args = "", fix = false, prefix = "") {
		if (extensions.length !== 1 || extensions[0] !== "swift") {
			throw new Error(`${this.name} error: File extensions are not configurable`);
		}

		const fixArg = fix ? "" : "--lint";
		return run(`${prefix} swiftformat ${fixArg} ${args} "."`, {
			dir,
			ignoreErrors: true,
		});
	}

	/**
	 * Parses the output of the lint command. Determines the success of the lint process and the
	 * severity of the identified code style violations
	 * @param {string} dir - Directory in which the linter has been run
	 * @param {{status: number, stdout: string, stderr: string}} output - Output of the lint command
	 * @returns {LintResult} - Parsed lint result
	 */
	static parseOutput(dir, output) {
		const lintResult = initLintResult();
		lintResult.isSuccess = output.status === 0;

		const matches = output.stderr.matchAll(PARSE_REGEX);
		for (const match of matches) {
			const [_, pathFull, line, rule, message] = match;
			const path = pathFull.substring(dir.length + 1);
			const lineNr = parseInt(line, 10);
			// SwiftFormat only seems to use the "warning" level, which this action will therefore
			// categorize as errors
			lintResult.error.push({
				path,
				firstLine: lineNr,
				lastLine: lineNr,
				message: `${message} (${rule})`,
			});
		}

		return lintResult;
	}
}

module.exports = SwiftFormatLockwood;


/***/ }),

/***/ 879:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const { run } = __nccwpck_require__(386);
const commandExists = __nccwpck_require__(525);
const { initLintResult } = __nccwpck_require__(314);

const PARSE_REGEX = /^(.*):([0-9]+):([0-9]+): (warning|error): (.*)$/gm;

/** @typedef {import('../utils/lint-result').LintResult} LintResult */

/**
 * https://github.com/apple/swift-format
 */
class SwiftFormatOfficial {
	static get name() {
		return "swift-format";
	}

	/**
	 * Verifies that all required programs are installed. Throws an error if programs are missing
	 * @param {string} dir - Directory to run the linting program in
	 * @param {string} prefix - Prefix to the lint command
	 */
	static async verifySetup(dir, prefix = "") {
		// Verify that swift-format is installed.
		if (!(await commandExists("swift-format"))) {
			throw new Error(`${this.name} is not installed`);
		}
	}

	/**
	 * Runs the linting program and returns the command output
	 * @param {string} dir - Directory to run the linter in
	 * @param {string[]} extensions - File extensions which should be linted
	 * @param {string} args - Additional arguments to pass to the linter
	 * @param {boolean} fix - Whether the linter should attempt to fix code style issues automatically
	 * @param {string} prefix - Prefix to the lint command
	 * @returns {{status: number, stdout: string, stderr: string}} - Output of the lint command
	 */
	static lint(dir, extensions, args = "", fix = false, prefix = "") {
		if (extensions.length !== 1 || extensions[0] !== "swift") {
			throw new Error(`${this.name} error: File extensions are not configurable`);
		}

		const mode = fix ? "format -i" : "lint";
		return run(`${prefix} swift-format ${mode} ${args} --recursive "."`, {
			dir,
			ignoreErrors: true,
		});
	}

	/**
	 * Parses the output of the lint command. Determines the success of the lint process and the
	 * severity of the identified code style violations
	 * @param {string} dir - Directory in which the linter has been run
	 * @param {{status: number, stdout: string, stderr: string}} output - Output of the lint command
	 * @returns {LintResult} - Parsed lint result
	 */
	static parseOutput(dir, output) {
		const lintResult = initLintResult();

		const matches = output.stderr.matchAll(PARSE_REGEX);
		for (const match of matches) {
			const [_line, pathFull, line, _column, _level, message] = match;
			const path = pathFull.substring(dir.length + 1);
			const lineNr = parseInt(line, 10);
			// swift-format only seems to use the "warning" level, which this action will therefore
			// categorize as errors
			lintResult.error.push({
				path,
				firstLine: lineNr,
				lastLine: lineNr,
				message: `${message}`,
			});
		}

		// Since 0.50300.0 swift-format exits with 0 even if there are formatting issues. Therefore,
		// this function determines the success of the linting process based on the number of parsed
		// errors.
		lintResult.isSuccess = lintResult.error.length === 0;

		return lintResult;
	}
}

module.exports = SwiftFormatOfficial;


/***/ }),

/***/ 370:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const { run } = __nccwpck_require__(386);
const commandExists = __nccwpck_require__(525);
const { initLintResult } = __nccwpck_require__(314);

const PARSE_REGEX = /^(.*):([0-9]+):[0-9]+: (warning|error): (.*)$/gm;

/** @typedef {import('../utils/lint-result').LintResult} LintResult */

/**
 * https://github.com/realm/SwiftLint
 */
class SwiftLint {
	static get name() {
		return "SwiftLint";
	}

	/**
	 * Verifies that all required programs are installed. Throws an error if programs are missing
	 * @param {string} dir - Directory to run the linting program in
	 * @param {string} prefix - Prefix to the lint command
	 */
	static async verifySetup(dir, prefix = "") {
		// Verify that SwiftLint is installed
		if (!(await commandExists("swiftlint"))) {
			throw new Error(`${this.name} is not installed`);
		}
	}

	/**
	 * Runs the linting program and returns the command output
	 * @param {string} dir - Directory to run the linter in
	 * @param {string[]} extensions - File extensions which should be linted
	 * @param {string} args - Additional arguments to pass to the linter
	 * @param {boolean} fix - Whether the linter should attempt to fix code style issues automatically
	 * @param {string} prefix - Prefix to the lint command
	 * @returns {{status: number, stdout: string, stderr: string}} - Output of the lint command
	 */
	static lint(dir, extensions, args = "", fix = false, prefix = "") {
		if (extensions.length !== 1 || extensions[0] !== "swift") {
			throw new Error(`${this.name} error: File extensions are not configurable`);
		}

		const fixArg = fix ? "--fix" : "";
		return run(`${prefix} swiftlint ${fixArg} ${args}`, {
			dir,
			ignoreErrors: true,
		});
	}

	/**
	 * Parses the output of the lint command. Determines the success of the lint process and the
	 * severity of the identified code style violations
	 * @param {string} dir - Directory in which the linter has been run
	 * @param {{status: number, stdout: string, stderr: string}} output - Output of the lint command
	 * @returns {LintResult} - Parsed lint result
	 */
	static parseOutput(dir, output) {
		const lintResult = initLintResult();
		lintResult.isSuccess = output.status === 0;

		const matches = output.stdout.matchAll(PARSE_REGEX);
		for (const match of matches) {
			const [_, pathFull, line, level, message] = match;
			const path = pathFull.substring(dir.length + 1);
			const lineNr = parseInt(line, 10);
			lintResult[level].push({
				path,
				firstLine: lineNr,
				lastLine: lineNr,
				message,
			});
		}

		return lintResult;
	}
}

module.exports = SwiftLint;


/***/ }),

/***/ 503:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const core = __nccwpck_require__(974);

const { run } = __nccwpck_require__(386);
const commandExists = __nccwpck_require__(525);
const { initLintResult } = __nccwpck_require__(314);
const { getNpmBinCommand } = __nccwpck_require__(148);
const { removeTrailingPeriod } = __nccwpck_require__(659);

/** @typedef {import('../utils/lint-result').LintResult} LintResult */

/**
 * https://www.typescriptlang.org/docs/handbook/compiler-options.html
 */
class TSC {
	static get name() {
		return "TypeScript";
	}

	/**
	 * Verifies that all required programs are installed. Throws an error if programs are missing
	 * @param {string} dir - Directory to run the linting program in
	 * @param {string} prefix - Prefix to the lint command
	 */
	static async verifySetup(dir, prefix = "") {
		// Verify that NPM is installed (required to execute ESLint)
		if (!(await commandExists("npm"))) {
			throw new Error("NPM is not installed");
		}

		// Verify that ESLint is installed
		const commandPrefix = prefix || getNpmBinCommand(dir);
		try {
			run(`${commandPrefix} tsc -v`, { dir });
		} catch (err) {
			throw new Error(`${this.name} is not installed`);
		}
	}

	/**
	 * Runs the linting program and returns the command output
	 * @param {string} dir - Directory to run the linter in
	 * @param {string[]} extensions - File extensions which should be linted
	 * @param {string} args - Additional arguments to pass to the linter
	 * @param {boolean} fix - Whether the linter should attempt to fix code style issues automatically
	 * @param {string} prefix - Prefix to the lint command
	 * @returns {{status: number, stdout: string, stderr: string}} - Output of the lint command
	 */
	static lint(dir, extensions, args = "", fix = false, prefix = "") {
		if (fix) {
			core.warning(`${this.name} does not support auto-fixing`);
		}

		const commandPrefix = prefix || getNpmBinCommand(dir);
		return run(`${commandPrefix} tsc --noEmit --pretty false ${args}`, {
			dir,
			ignoreErrors: true,
		});
	}

	/**
	 * Parses the output of the lint command. Determines the success of the lint process and the
	 * severity of the identified code style violations
	 * @param {string} dir - Directory in which the linter has been run
	 * @param {{status: number, stdout: string, stderr: string}} output - Output of the lint command
	 * @returns {LintResult} - Parsed lint result
	 */
	static parseOutput(dir, output) {
		const lintResult = initLintResult();
		lintResult.isSuccess = output.status === 0;

		// example: file1.ts(4,25): error TS7005: Variable 'str' implicitly has an 'any' type.
		const regex = /^(?<file>.+)\((?<line>\d+),(?<column>\d+)\):\s(?<code>\w+)\s(?<message>.+)$/gm;

		const errors = [];
		const matches = output.stdout.matchAll(regex);

		for (const match of matches) {
			const { file, line, column, code, message } = match.groups;
			errors.push({ file, line, column, code, message });
		}

		for (const error of errors) {
			const { file, line, message } = error;

			const entry = {
				path: file,
				firstLine: Number(line),
				lastLine: Number(line),
				message: `${removeTrailingPeriod(message)}`,
			};

			lintResult.error.push(entry);
		}

		return lintResult;
	}
}

module.exports = TSC;


/***/ }),

/***/ 638:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const { run } = __nccwpck_require__(386);
const commandExists = __nccwpck_require__(525);
const { getNpmBinCommand } = __nccwpck_require__(148);
const ESLint = __nccwpck_require__(22);

/**
 * https://github.com/xojs/xo
 * XO is a wrapper for ESLint, so it can use the same logic for parsing lint results
 */
class XO extends ESLint {
	static get name() {
		return "XO";
	}

	/**
	 * Verifies that all required programs are installed. Throws an error if programs are missing
	 * @param {string} dir - Directory to run the linting program in
	 * @param {string} prefix - Prefix to the lint command
	 */
	static async verifySetup(dir, prefix = "") {
		// Verify that NPM is installed (required to execute XO)
		if (!(await commandExists("npm"))) {
			throw new Error("NPM is not installed");
		}

		// Verify that XO is installed
		const commandPrefix = prefix || getNpmBinCommand(dir);
		try {
			run(`${commandPrefix} xo --version`, { dir });
		} catch (err) {
			throw new Error(`${this.name} is not installed`);
		}
	}

	/**
	 * Runs the linting program and returns the command output
	 * @param {string} dir - Directory to run the linter in
	 * @param {string[]} extensions - File extensions which should be linted
	 * @param {string} args - Additional arguments to pass to the linter
	 * @param {boolean} fix - Whether the linter should attempt to fix code style issues automatically
	 * @param {string} prefix - Prefix to the lint command
	 * @returns {{status: number, stdout: string, stderr: string}} - Output of the lint command
	 */
	static lint(dir, extensions, args = "", fix = false, prefix = "") {
		const extensionArgs = extensions.map((ext) => `--extension ${ext}`).join(" ");
		const fixArg = fix ? "--fix" : "";
		const commandPrefix = prefix || getNpmBinCommand(dir);
		return run(`${commandPrefix} xo ${extensionArgs} ${fixArg} --reporter json ${args} "."`, {
			dir,
			ignoreErrors: true,
		});
	}
}

module.exports = XO;


/***/ }),

/***/ 386:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const { execSync } = __nccwpck_require__(81);

const core = __nccwpck_require__(974);

const RUN_OPTIONS_DEFAULTS = { dir: null, ignoreErrors: false, prefix: "" };

/**
 * Returns the value for an environment variable. If the variable is required but doesn't have a
 * value, an error is thrown
 * @param {string} name - Name of the environment variable
 * @param {boolean} required - Whether an error should be thrown if the variable doesn't have a
 * value
 * @returns {string | null} - Value of the environment variable
 */
function getEnv(name, required = false) {
	const nameUppercase = name.toUpperCase();
	const value = process.env[nameUppercase];
	if (value == null) {
		// Value is either not set (`undefined`) or set to `null`
		if (required) {
			throw new Error(`Environment variable "${nameUppercase}" is not defined`);
		}
		return null;
	}
	return value;
}

/**
 * Executes the provided shell command
 * @param {string} cmd - Shell command to execute
 * @param {{dir: string, ignoreErrors: boolean}} [options] - {@see RUN_OPTIONS_DEFAULTS}
 * @returns {{status: number, stdout: string, stderr: string}} - Output of the shell command
 */
function run(cmd, options) {
	const optionsWithDefaults = {
		...RUN_OPTIONS_DEFAULTS,
		...options,
	};

	core.debug(cmd);

	try {
		const stdout = execSync(cmd, {
			encoding: "utf8",
			cwd: optionsWithDefaults.dir,
			maxBuffer: 20 * 1024 * 1024,
		});
		const output = {
			status: 0,
			stdout: stdout.trim(),
			stderr: "",
		};

		core.debug(`Stdout: ${output.stdout}`);

		return output;
	} catch (err) {
		if (optionsWithDefaults.ignoreErrors) {
			const output = {
				status: err.status,
				stdout: err.stdout.trim(),
				stderr: err.stderr.trim(),
			};

			core.debug(`Exit code: ${output.status}`);
			core.debug(`Stdout: ${output.stdout}`);
			core.debug(`Stderr: ${output.stderr}`);

			return output;
		}
		throw err;
	}
}

module.exports = {
	getEnv,
	run,
};


/***/ }),

/***/ 525:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const checkForCommand = __nccwpck_require__(983);

/**
 * Returns whether the provided shell command is available
 * @param {string} command - Shell command to check for
 * @returns {Promise<boolean>} - Whether the command is available
 */
async function commandExists(command) {
	// The `command-exists` library throws an error if the command is not available. This function
	// catches these errors and returns a boolean value instead
	try {
		await checkForCommand(command);
		return true;
	} catch (error) {
		return false;
	}
}

module.exports = commandExists;


/***/ }),

/***/ 984:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const parseDiff = __nccwpck_require__(43);

/**
 * Parses linting errors from a unified diff
 * @param {string} diff - Unified diff
 * @returns {{path: string, firstLine: number, lastLine: number, message: string}[]} - Array of
 * parsed errors
 */
function parseErrorsFromDiff(diff) {
	const errors = [];
	const files = parseDiff(diff);
	for (const file of files) {
		const { chunks, to: path } = file;
		for (const chunk of chunks) {
			const { oldStart, oldLines, changes } = chunk;
			const chunkDiff = changes.map((change) => change.content).join("\n");
			errors.push({
				path,
				firstLine: oldStart,
				lastLine: oldStart + oldLines,
				message: chunkDiff,
			});
		}
	}
	return errors;
}

module.exports = {
	parseErrorsFromDiff,
};


/***/ }),

/***/ 314:
/***/ ((module) => {

/**
 * Lint result object.
 * @typedef LintResult
 * @property {boolean} isSuccess Whether the result is success.
 * @property {object[]} warning Warnings.
 * @property {object[]} error Errors.
 */

/**
 * Returns an object for storing linting results
 * @returns {LintResult} - Default object
 */
function initLintResult() {
	return {
		isSuccess: true, // Usually determined by the exit code of the linting command
		warning: [],
		error: [],
	};
}

/**
 * Returns a text summary of the number of issues found when linting
 * @param {LintResult} lintResult - Parsed linter
 * output
 * @returns {string} - Text summary
 */
function getSummary(lintResult) {
	const nrErrors = lintResult.error.length;
	const nrWarnings = lintResult.warning.length;
	// Build and log a summary of linting errors/warnings
	if (nrWarnings > 0 && nrErrors > 0) {
		return `${nrErrors} error${nrErrors > 1 ? "s" : ""} and ${nrWarnings} warning${
			nrWarnings > 1 ? "s" : ""
		}`;
	}
	if (nrErrors > 0) {
		return `${nrErrors} error${nrErrors > 1 ? "s" : ""}`;
	}
	if (nrWarnings > 0) {
		return `${nrWarnings} warning${nrWarnings > 1 ? "s" : ""}`;
	}
	return `no issues`;
}

module.exports = {
	getSummary,
	initLintResult,
};


/***/ }),

/***/ 148:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const { useYarn } = __nccwpck_require__(551);

/**
 * Returns the NPM or Yarn command ({@see useYarn()}) for executing an NPM binary
 * @param {string} [pkgRoot] - Package directory (directory where Yarn lockfile would exist)
 * @returns {string} - NPM/Yarn command for executing the NPM binary. The binary name should be
 * appended to this command
 */
function getNpmBinCommand(pkgRoot) {
	return useYarn(pkgRoot) ? "yarn run --silent" : "npx --no-install";
}

module.exports = { getNpmBinCommand };


/***/ }),

/***/ 551:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const { existsSync } = __nccwpck_require__(147);
const { join } = __nccwpck_require__(17);

const YARN_LOCK_NAME = "yarn.lock";

/**
 * Determines whether Yarn should be used to execute commands or binaries. This decision is based on
 * the existence of a Yarn lockfile in the package directory. The distinction between NPM and Yarn
 * is necessary e.g. for Yarn Plug'n'Play to work
 * @param {string} [pkgRoot] - Package directory (directory where Yarn lockfile would exist)
 * @returns {boolean} - Whether Yarn should be used
 */
function useYarn(pkgRoot) {
	// Use an absolute path if `pkgRoot` is specified and a relative one (current directory) otherwise
	const lockfilePath = pkgRoot ? join(pkgRoot, YARN_LOCK_NAME) : YARN_LOCK_NAME;
	return existsSync(lockfilePath);
}

module.exports = { useYarn };


/***/ }),

/***/ 758:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const https = __nccwpck_require__(687);

/**
 * Helper function for making HTTP requests
 * @param {string | URL} url - Request URL
 * @param {object} options - Request options
 * @returns {Promise<object>} - JSON response
 */
function request(url, options) {
	return new Promise((resolve, reject) => {
		const req = https
			.request(url, options, (res) => {
				let data = "";
				res.on("data", (chunk) => {
					data += chunk;
				});
				res.on("end", () => {
					if (res.statusCode >= 400) {
						const err = new Error(`Received status code ${res.statusCode}`);
						err.response = res;
						err.data = data;
						reject(err);
					} else {
						resolve({ res, data: JSON.parse(data) });
					}
				});
			})
			.on("error", reject);
		if (options.body) {
			req.end(JSON.stringify(options.body));
		} else {
			req.end();
		}
	});
}

module.exports = request;


/***/ }),

/***/ 659:
/***/ ((module) => {

/**
 * Capitalizes the first letter of a string
 * @param {string} str - String to process
 * @returns {string} - Input string with first letter capitalized
 */
function capitalizeFirstLetter(str) {
	return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Removes the trailing period from the provided string (if it has one)
 * @param {string} str - String to process
 * @returns {string} - String without trailing period
 */
function removeTrailingPeriod(str) {
	return str[str.length - 1] === "." ? str.substring(0, str.length - 1) : str;
}

module.exports = {
	capitalizeFirstLetter,
	removeTrailingPeriod,
};


/***/ }),

/***/ 974:
/***/ ((module) => {

module.exports = eval("require")("@actions/core");


/***/ }),

/***/ 983:
/***/ ((module) => {

module.exports = eval("require")("command-exists");


/***/ }),

/***/ 531:
/***/ ((module) => {

module.exports = eval("require")("glob");


/***/ }),

/***/ 43:
/***/ ((module) => {

module.exports = eval("require")("parse-diff");


/***/ }),

/***/ 867:
/***/ ((module) => {

module.exports = eval("require")("shescape");


/***/ }),

/***/ 81:
/***/ ((module) => {

"use strict";
module.exports = require("child_process");

/***/ }),

/***/ 147:
/***/ ((module) => {

"use strict";
module.exports = require("fs");

/***/ }),

/***/ 687:
/***/ ((module) => {

"use strict";
module.exports = require("https");

/***/ }),

/***/ 17:
/***/ ((module) => {

"use strict";
module.exports = require("path");

/***/ }),

/***/ 598:
/***/ ((module) => {

"use strict";
module.exports = JSON.parse('{"name":"lint-action","version":"2.3.0","description":"GitHub Action for detecting and fixing linting errors","repository":"github:wearerequired/lint-action","license":"MIT","private":true,"main":"./dist/index.js","scripts":{"test":"jest","lint":"eslint --max-warnings 0 \\"**/*.js\\"","lint:fix":"yarn lint --fix","format":"prettier --list-different \\"**/*.{css,html,js,json,jsx,less,md,scss,ts,tsx,vue,yaml,yml}\\"","format:fix":"yarn format --write","build":"ncc build ./src/index.js"},"dependencies":{"@actions/core":"^1.10.0","command-exists":"^1.2.9","glob":"^8.1.0","parse-diff":"^0.11.0","shescape":"^1.6.4"},"peerDependencies":{},"devDependencies":{"@samuelmeuli/eslint-config":"^6.0.0","@samuelmeuli/prettier-config":"^2.0.1","@vercel/ncc":"^0.36.0","eslint":"8.32.0","eslint-config-airbnb-base":"15.0.0","eslint-config-prettier":"^8.6.0","eslint-plugin-import":"^2.26.0","eslint-plugin-jsdoc":"^39.6.7","fs-extra":"^11.1.0","jest":"^29.3.1","prettier":"^2.8.3"},"eslintConfig":{"root":true,"extends":["@samuelmeuli/eslint-config","plugin:jsdoc/recommended"],"env":{"node":true,"jest":true},"settings":{"jsdoc":{"mode":"typescript"}},"rules":{"no-await-in-loop":"off","no-unused-vars":["error",{"args":"none","varsIgnorePattern":"^_"}],"jsdoc/check-indentation":"error","jsdoc/check-syntax":"error","jsdoc/newline-after-description":["error","never"],"jsdoc/require-description":"error","jsdoc/require-hyphen-before-param-description":"error","jsdoc/require-jsdoc":"off"}},"eslintIgnore":["node_modules/","test/linters/projects/","test/tmp/","dist/"],"jest":{"setupFiles":["./test/mock-actions-core.js"]},"prettier":"@samuelmeuli/prettier-config"}');

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __nccwpck_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		var threw = true;
/******/ 		try {
/******/ 			__webpack_modules__[moduleId](module, module.exports, __nccwpck_require__);
/******/ 			threw = false;
/******/ 		} finally {
/******/ 			if(threw) delete __webpack_module_cache__[moduleId];
/******/ 		}
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat */
/******/ 	
/******/ 	if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = __dirname + "/";
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry need to be wrapped in an IIFE because it need to be isolated against other modules in the chunk.
(() => {
const { existsSync } = __nccwpck_require__(147);
const { join } = __nccwpck_require__(17);

const core = __nccwpck_require__(974);

const git = __nccwpck_require__(408);
const { createCheck } = __nccwpck_require__(364);
const { getContext } = __nccwpck_require__(740);
const linters = __nccwpck_require__(727);
const { getSummary } = __nccwpck_require__(314);

/**
 * Parses the action configuration and runs all enabled linters on matching files
 */
async function runAction() {
	const context = getContext();
	const autoFix = core.getInput("auto_fix") === "true";
	const commit = core.getInput("commit") === "true";
	const skipVerification = core.getInput("git_no_verify") === "true";
	const continueOnError = core.getInput("continue_on_error") === "true";
	const gitName = core.getInput("git_name", { required: true });
	const gitEmail = core.getInput("git_email", { required: true });
	const commitMessage = core.getInput("commit_message", { required: true });
	const checkName = core.getInput("check_name", { required: true });
	const neutralCheckOnWarning = core.getInput("neutral_check_on_warning") === "true";
	const isPullRequest =
		context.eventName === "pull_request" || context.eventName === "pull_request_target";

	// If on a PR from fork: Display messages regarding action limitations
	if (context.eventName === "pull_request" && context.repository.hasFork) {
		core.error(
			"This action does not have permission to create annotations on forks. You may want to run it only on `pull_request_target` events with checks permissions set to write. See https://docs.github.com/en/actions/learn-github-actions/workflow-syntax-for-github-actions#permissions for details.",
		);
	}
	if (isPullRequest && context.repository.hasFork && autoFix) {
		core.error(
			"This action does not have permission to push to forks. You may want to run it only on `push` events.",
		);
	}

	if (autoFix) {
		// Set Git committer username and password
		git.setUserInfo(gitName, gitEmail);
	}
	if (isPullRequest) {
		// Fetch and check out PR branch:
		// - "push" event: Already on correct branch
		// - "pull_request" event on origin, for code on origin: The Checkout Action
		//   (https://github.com/actions/checkout) checks out the PR's test merge commit instead of the
		//   PR branch. Git is therefore in detached head state. To be able to push changes, the branch
		//   needs to be fetched and checked out first
		// - "pull_request" event on origin, for code on fork: Same as above, but the repo/branch where
		//   changes need to be pushed is not yet available. The fork needs to be added as a Git remote
		//   first
		git.checkOutRemoteBranch(context);
	}

	let headSha = git.getHeadSha();

	let hasFailures = false;
	const checks = [];

	// Loop over all available linters
	for (const [linterId, linter] of Object.entries(linters)) {
		// Determine whether the linter should be executed on the commit
		if (core.getInput(linterId) === "true") {
			core.startGroup(`Run ${linter.name}`);

			const fileExtensions = core.getInput(`${linterId}_extensions`, { required: true });
			const args = core.getInput(`${linterId}_args`);
			const lintDirRel = core.getInput(`${linterId}_dir`) || ".";
			const prefix = core.getInput(`${linterId}_command_prefix`);
			const lintDirAbs = join(context.workspace, lintDirRel);
			const linterAutoFix = autoFix && core.getInput(`${linterId}_auto_fix`) === "true";

			if (!existsSync(lintDirAbs)) {
				throw new Error(`Directory ${lintDirAbs} for ${linter.name} doesn't exist`);
			}

			// Check that the linter and its dependencies are installed
			core.info(`Verifying setup for ${linter.name}…`);
			await linter.verifySetup(lintDirAbs, prefix);
			core.info(`Verified ${linter.name} setup`);

			// Determine which files should be linted
			const fileExtList = fileExtensions.split(",");
			core.info(`Will use ${linter.name} to check the files with extensions ${fileExtList}`);

			// Lint and optionally auto-fix the matching files, parse code style violations
			core.info(
				`Linting ${linterAutoFix ? "and auto-fixing " : ""}files in ${lintDirAbs} ` +
					`with ${linter.name} ${args ? `and args: ${args}` : ""}…`,
			);
			const lintOutput = linter.lint(lintDirAbs, fileExtList, args, linterAutoFix, prefix);

			// Parse output of linting command
			const lintResult = linter.parseOutput(context.workspace, lintOutput);
			const summary = getSummary(lintResult);
			core.info(
				`${linter.name} found ${summary} (${lintResult.isSuccess ? "success" : "failure"})`,
			);

			if (!lintResult.isSuccess) {
				hasFailures = true;
			}

			if (linterAutoFix && commit) {
				// Commit and push auto-fix changes
				if (git.hasChanges()) {
					git.commitChanges(commitMessage.replace(/\${linter}/g, linter.name), skipVerification);
					git.pushChanges(skipVerification);
				}
			}

			const lintCheckName = checkName
				.replace(/\${linter}/g, linter.name)
				.replace(/\${dir}/g, lintDirRel !== "." ? `${lintDirRel}` : "")
				.trim();

			checks.push({ lintCheckName, lintResult, summary });

			core.endGroup();
		}
	}

	// Add commit annotations after running all linters. To be displayed on pull requests, the
	// annotations must be added to the last commit on the branch. This can either be a user commit or
	// one of the auto-fix commits
	if (isPullRequest && autoFix) {
		headSha = git.getHeadSha();
	}

	core.startGroup("Create check runs with commit annotations");
	let groupClosed = false;
	try {
		await Promise.all(
			checks.map(({ lintCheckName, lintResult, summary }) =>
				createCheck(lintCheckName, headSha, context, lintResult, neutralCheckOnWarning, summary),
			),
		);
	} catch (err) {
		core.endGroup();
		groupClosed = true;
		core.warning("Some check runs could not be created.");
	}
	if (!groupClosed) {
		core.endGroup();
	}

	if (hasFailures && !continueOnError) {
		core.setFailed("Linting failures detected. See check runs with annotations for details.");
	}
}

runAction().catch((error) => {
	core.debug(error.stack || "No error stack trace");
	core.setFailed(error.message);
});

})();

module.exports = __webpack_exports__;
/******/ })()
;