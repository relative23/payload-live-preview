
// this file is generated — do not edit it


/// <reference types="@sveltejs/kit" />

/**
 * This module provides access to environment variables that are injected _statically_ into your bundle at build time and are limited to _private_ access.
 * 
 * |         | Runtime                                                                    | Build time                                                               |
 * | ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
 * | Private | [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private) | [`$env/static/private`](https://svelte.dev/docs/kit/$env-static-private) |
 * | Public  | [`$env/dynamic/public`](https://svelte.dev/docs/kit/$env-dynamic-public)   | [`$env/static/public`](https://svelte.dev/docs/kit/$env-static-public)   |
 * 
 * Static environment variables are [loaded by Vite](https://vitejs.dev/guide/env-and-mode.html#env-files) from `.env` files and `process.env` at build time and then statically injected into your bundle at build time, enabling optimisations like dead code elimination.
 * 
 * **_Private_ access:**
 * 
 * - This module cannot be imported into client-side code
 * - This module only includes variables that _do not_ begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) _and do_ start with [`config.kit.env.privatePrefix`](https://svelte.dev/docs/kit/configuration#env) (if configured)
 * 
 * For example, given the following build time environment:
 * 
 * ```env
 * ENVIRONMENT=production
 * PUBLIC_BASE_URL=http://site.com
 * ```
 * 
 * With the default `publicPrefix` and `privatePrefix`:
 * 
 * ```ts
 * import { ENVIRONMENT, PUBLIC_BASE_URL } from '$env/static/private';
 * 
 * console.log(ENVIRONMENT); // => "production"
 * console.log(PUBLIC_BASE_URL); // => throws error during build
 * ```
 * 
 * The above values will be the same _even if_ different values for `ENVIRONMENT` or `PUBLIC_BASE_URL` are set at runtime, as they are statically replaced in your code with their build time values.
 */
declare module '$env/static/private' {
	export const TERM_SESSION_ID: string;
	export const GJS_DEBUG_TOPICS: string;
	export const XDG_ACTIVATION_TOKEN: string;
	export const LESSOPEN: string;
	export const AI_AGENT: string;
	export const SNAP_INSTANCE_KEY: string;
	export const USER: string;
	export const SNAP_COMMON: string;
	export const CLAUDE_CODE_ENTRYPOINT: string;
	export const npm_config_user_agent: string;
	export const DISABLE_TELEMETRY: string;
	export const GIT_EDITOR: string;
	export const XDG_SESSION_TYPE: string;
	export const npm_node_execpath: string;
	export const BROWSER: string;
	export const SNAP_UID: string;
	export const SHLVL: string;
	export const LD_LIBRARY_PATH: string;
	export const npm_config_noproxy: string;
	export const HOME: string;
	export const MOZ_ENABLE_WAYLAND: string;
	export const SNAP_LIBRARY_PATH: string;
	export const DESKTOP_SESSION: string;
	export const SNAP_USER_DATA: string;
	export const npm_package_json: string;
	export const TERMINAL_EMULATOR: string;
	export const IM_CONFIG_ENTRY: string;
	export const GIO_LAUNCHED_DESKTOP_FILE: string;
	export const npm_package_engines_node: string;
	export const GTK_MODULES: string;
	export const CLAUDE_CODE_CHILD_SESSION: string;
	export const MANAGERPID: string;
	export const npm_config_userconfig: string;
	export const npm_config_local_prefix: string;
	export const SYSTEMD_EXEC_PID: string;
	export const DO_NOT_TRACK: string;
	export const DBUS_SESSION_BUS_ADDRESS: string;
	export const SNAP_REVISION: string;
	export const GIO_LAUNCHED_DESKTOP_FILE_PID: string;
	export const COLOR: string;
	export const DEBUGINFOD_URLS: string;
	export const npm_config_metrics_registry: string;
	export const WAYLAND_DISPLAY: string;
	export const npm_config_audit: string;
	export const FORCE_COLOR: string;
	export const LOGNAME: string;
	export const SNAP_CONTEXT: string;
	export const MANAGERPIDFDID: string;
	export const JOURNAL_STREAM: string;
	export const _: string;
	export const npm_config_prefix: string;
	export const MEMORY_PRESSURE_WATCH: string;
	export const CLAUDE_CODE_SSE_PORT: string;
	export const XDG_SESSION_CLASS: string;
	export const SNAP_VERSION: string;
	export const PLAYWRIGHT_TEST: string;
	export const USERNAME: string;
	export const TERM: string;
	export const npm_config_cache: string;
	export const DEBUG_COLORS: string;
	export const GNOME_DESKTOP_SESSION_ID: string;
	export const SNAP_INSTANCE_NAME: string;
	export const npm_config_node_gyp: string;
	export const PATH: string;
	export const INVOCATION_ID: string;
	export const NODE: string;
	export const npm_package_name: string;
	export const COREPACK_ENABLE_AUTO_PIN: string;
	export const XDG_MENU_PREFIX: string;
	export const GNOME_SETUP_DISPLAY: string;
	export const SNAP_DATA: string;
	export const XDG_RUNTIME_DIR: string;
	export const CLAUDE_EFFORT: string;
	export const DISPLAY: string;
	export const DESKTOP_STARTUP_ID: string;
	export const NoDefaultCurrentDirectoryInExePath: string;
	export const LANG: string;
	export const XDG_CURRENT_DESKTOP: string;
	export const XMODIFIERS: string;
	export const LIBVA_DRIVER_NAME: string;
	export const XDG_SESSION_DESKTOP: string;
	export const XAUTHORITY: string;
	export const LS_COLORS: string;
	export const FIG_TERM: string;
	export const npm_config_fund: string;
	export const npm_lifecycle_script: string;
	export const SNAP_USER_COMMON: string;
	export const SSH_AUTH_SOCK: string;
	export const MOZ_DRM_DEVICE: string;
	export const SNAP_ARCH: string;
	export const SNAP_COOKIE: string;
	export const SHELL: string;
	export const npm_package_version: string;
	export const npm_lifecycle_event: string;
	export const QT_ACCESSIBILITY: string;
	export const SNAP_REEXEC: string;
	export const GDMSESSION: string;
	export const CLAUDE_CODE_SESSION_ID: string;
	export const LESSCLOSE: string;
	export const SNAP_NAME: string;
	export const CLAUDECODE: string;
	export const GPG_AGENT_INFO: string;
	export const SENTRY_DSN: string;
	export const GJS_DEBUG_OUTPUT: string;
	export const QT_IM_MODULE: string;
	export const npm_config_globalconfig: string;
	export const npm_config_init_module: string;
	export const PWD: string;
	export const PROCESS_LAUNCHED_BY_CW: string;
	export const ENABLE_IDE_INTEGRATION: string;
	export const INTELLIJ_TERMINAL_COMMAND_BLOCKS_REWORKED: string;
	export const CUDA_HOME: string;
	export const npm_config_globalignorefile: string;
	export const npm_execpath: string;
	export const XDG_CONFIG_DIRS: string;
	export const SNAP_REAL_HOME: string;
	export const XDG_DATA_DIRS: string;
	export const CLAUDE_CODE_EXECPATH: string;
	export const XDG_SESSION_EXTRA_DEVICE_ACCESS: string;
	export const npm_config_global_prefix: string;
	export const CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: string;
	export const SNAP_EUID: string;
	export const NVD_BACKEND: string;
	export const SNAP: string;
	export const npm_command: string;
	export const QT_IM_MODULES: string;
	export const MEMORY_PRESSURE_WRITE: string;
	export const PROCESS_LAUNCHED_BY_Q: string;
	export const INIT_CWD: string;
	export const EDITOR: string;
	export const NODE_ENV: string;
}

/**
 * This module provides access to environment variables that are injected _statically_ into your bundle at build time and are _publicly_ accessible.
 * 
 * |         | Runtime                                                                    | Build time                                                               |
 * | ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
 * | Private | [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private) | [`$env/static/private`](https://svelte.dev/docs/kit/$env-static-private) |
 * | Public  | [`$env/dynamic/public`](https://svelte.dev/docs/kit/$env-dynamic-public)   | [`$env/static/public`](https://svelte.dev/docs/kit/$env-static-public)   |
 * 
 * Static environment variables are [loaded by Vite](https://vitejs.dev/guide/env-and-mode.html#env-files) from `.env` files and `process.env` at build time and then statically injected into your bundle at build time, enabling optimisations like dead code elimination.
 * 
 * **_Public_ access:**
 * 
 * - This module _can_ be imported into client-side code
 * - **Only** variables that begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) (which defaults to `PUBLIC_`) are included
 * 
 * For example, given the following build time environment:
 * 
 * ```env
 * ENVIRONMENT=production
 * PUBLIC_BASE_URL=http://site.com
 * ```
 * 
 * With the default `publicPrefix` and `privatePrefix`:
 * 
 * ```ts
 * import { ENVIRONMENT, PUBLIC_BASE_URL } from '$env/static/public';
 * 
 * console.log(ENVIRONMENT); // => throws error during build
 * console.log(PUBLIC_BASE_URL); // => "http://site.com"
 * ```
 * 
 * The above values will be the same _even if_ different values for `ENVIRONMENT` or `PUBLIC_BASE_URL` are set at runtime, as they are statically replaced in your code with their build time values.
 */
declare module '$env/static/public' {
	
}

/**
 * This module provides access to environment variables set _dynamically_ at runtime and that are limited to _private_ access.
 * 
 * |         | Runtime                                                                    | Build time                                                               |
 * | ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
 * | Private | [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private) | [`$env/static/private`](https://svelte.dev/docs/kit/$env-static-private) |
 * | Public  | [`$env/dynamic/public`](https://svelte.dev/docs/kit/$env-dynamic-public)   | [`$env/static/public`](https://svelte.dev/docs/kit/$env-static-public)   |
 * 
 * Dynamic environment variables are defined by the platform you're running on. For example if you're using [`adapter-node`](https://github.com/sveltejs/kit/tree/main/packages/adapter-node) (or running [`vite preview`](https://svelte.dev/docs/kit/cli)), this is equivalent to `process.env`.
 * 
 * **_Private_ access:**
 * 
 * - This module cannot be imported into client-side code
 * - This module includes variables that _do not_ begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) _and do_ start with [`config.kit.env.privatePrefix`](https://svelte.dev/docs/kit/configuration#env) (if configured)
 * 
 * > [!NOTE] In `dev`, `$env/dynamic` includes environment variables from `.env`. In `prod`, this behavior will depend on your adapter.
 * 
 * > [!NOTE] To get correct types, environment variables referenced in your code should be declared (for example in an `.env` file), even if they don't have a value until the app is deployed:
 * >
 * > ```env
 * > MY_FEATURE_FLAG=
 * > ```
 * >
 * > You can override `.env` values from the command line like so:
 * >
 * > ```sh
 * > MY_FEATURE_FLAG="enabled" npm run dev
 * > ```
 * 
 * For example, given the following runtime environment:
 * 
 * ```env
 * ENVIRONMENT=production
 * PUBLIC_BASE_URL=http://site.com
 * ```
 * 
 * With the default `publicPrefix` and `privatePrefix`:
 * 
 * ```ts
 * import { env } from '$env/dynamic/private';
 * 
 * console.log(env.ENVIRONMENT); // => "production"
 * console.log(env.PUBLIC_BASE_URL); // => undefined
 * ```
 */
declare module '$env/dynamic/private' {
	export const env: {
		TERM_SESSION_ID: string;
		GJS_DEBUG_TOPICS: string;
		XDG_ACTIVATION_TOKEN: string;
		LESSOPEN: string;
		AI_AGENT: string;
		SNAP_INSTANCE_KEY: string;
		USER: string;
		SNAP_COMMON: string;
		CLAUDE_CODE_ENTRYPOINT: string;
		npm_config_user_agent: string;
		DISABLE_TELEMETRY: string;
		GIT_EDITOR: string;
		XDG_SESSION_TYPE: string;
		npm_node_execpath: string;
		BROWSER: string;
		SNAP_UID: string;
		SHLVL: string;
		LD_LIBRARY_PATH: string;
		npm_config_noproxy: string;
		HOME: string;
		MOZ_ENABLE_WAYLAND: string;
		SNAP_LIBRARY_PATH: string;
		DESKTOP_SESSION: string;
		SNAP_USER_DATA: string;
		npm_package_json: string;
		TERMINAL_EMULATOR: string;
		IM_CONFIG_ENTRY: string;
		GIO_LAUNCHED_DESKTOP_FILE: string;
		npm_package_engines_node: string;
		GTK_MODULES: string;
		CLAUDE_CODE_CHILD_SESSION: string;
		MANAGERPID: string;
		npm_config_userconfig: string;
		npm_config_local_prefix: string;
		SYSTEMD_EXEC_PID: string;
		DO_NOT_TRACK: string;
		DBUS_SESSION_BUS_ADDRESS: string;
		SNAP_REVISION: string;
		GIO_LAUNCHED_DESKTOP_FILE_PID: string;
		COLOR: string;
		DEBUGINFOD_URLS: string;
		npm_config_metrics_registry: string;
		WAYLAND_DISPLAY: string;
		npm_config_audit: string;
		FORCE_COLOR: string;
		LOGNAME: string;
		SNAP_CONTEXT: string;
		MANAGERPIDFDID: string;
		JOURNAL_STREAM: string;
		_: string;
		npm_config_prefix: string;
		MEMORY_PRESSURE_WATCH: string;
		CLAUDE_CODE_SSE_PORT: string;
		XDG_SESSION_CLASS: string;
		SNAP_VERSION: string;
		PLAYWRIGHT_TEST: string;
		USERNAME: string;
		TERM: string;
		npm_config_cache: string;
		DEBUG_COLORS: string;
		GNOME_DESKTOP_SESSION_ID: string;
		SNAP_INSTANCE_NAME: string;
		npm_config_node_gyp: string;
		PATH: string;
		INVOCATION_ID: string;
		NODE: string;
		npm_package_name: string;
		COREPACK_ENABLE_AUTO_PIN: string;
		XDG_MENU_PREFIX: string;
		GNOME_SETUP_DISPLAY: string;
		SNAP_DATA: string;
		XDG_RUNTIME_DIR: string;
		CLAUDE_EFFORT: string;
		DISPLAY: string;
		DESKTOP_STARTUP_ID: string;
		NoDefaultCurrentDirectoryInExePath: string;
		LANG: string;
		XDG_CURRENT_DESKTOP: string;
		XMODIFIERS: string;
		LIBVA_DRIVER_NAME: string;
		XDG_SESSION_DESKTOP: string;
		XAUTHORITY: string;
		LS_COLORS: string;
		FIG_TERM: string;
		npm_config_fund: string;
		npm_lifecycle_script: string;
		SNAP_USER_COMMON: string;
		SSH_AUTH_SOCK: string;
		MOZ_DRM_DEVICE: string;
		SNAP_ARCH: string;
		SNAP_COOKIE: string;
		SHELL: string;
		npm_package_version: string;
		npm_lifecycle_event: string;
		QT_ACCESSIBILITY: string;
		SNAP_REEXEC: string;
		GDMSESSION: string;
		CLAUDE_CODE_SESSION_ID: string;
		LESSCLOSE: string;
		SNAP_NAME: string;
		CLAUDECODE: string;
		GPG_AGENT_INFO: string;
		SENTRY_DSN: string;
		GJS_DEBUG_OUTPUT: string;
		QT_IM_MODULE: string;
		npm_config_globalconfig: string;
		npm_config_init_module: string;
		PWD: string;
		PROCESS_LAUNCHED_BY_CW: string;
		ENABLE_IDE_INTEGRATION: string;
		INTELLIJ_TERMINAL_COMMAND_BLOCKS_REWORKED: string;
		CUDA_HOME: string;
		npm_config_globalignorefile: string;
		npm_execpath: string;
		XDG_CONFIG_DIRS: string;
		SNAP_REAL_HOME: string;
		XDG_DATA_DIRS: string;
		CLAUDE_CODE_EXECPATH: string;
		XDG_SESSION_EXTRA_DEVICE_ACCESS: string;
		npm_config_global_prefix: string;
		CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: string;
		SNAP_EUID: string;
		NVD_BACKEND: string;
		SNAP: string;
		npm_command: string;
		QT_IM_MODULES: string;
		MEMORY_PRESSURE_WRITE: string;
		PROCESS_LAUNCHED_BY_Q: string;
		INIT_CWD: string;
		EDITOR: string;
		NODE_ENV: string;
		[key: `PUBLIC_${string}`]: undefined;
		[key: `${string}`]: string | undefined;
	}
}

/**
 * This module provides access to environment variables set _dynamically_ at runtime and that are _publicly_ accessible.
 * 
 * |         | Runtime                                                                    | Build time                                                               |
 * | ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
 * | Private | [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private) | [`$env/static/private`](https://svelte.dev/docs/kit/$env-static-private) |
 * | Public  | [`$env/dynamic/public`](https://svelte.dev/docs/kit/$env-dynamic-public)   | [`$env/static/public`](https://svelte.dev/docs/kit/$env-static-public)   |
 * 
 * Dynamic environment variables are defined by the platform you're running on. For example if you're using [`adapter-node`](https://github.com/sveltejs/kit/tree/main/packages/adapter-node) (or running [`vite preview`](https://svelte.dev/docs/kit/cli)), this is equivalent to `process.env`.
 * 
 * **_Public_ access:**
 * 
 * - This module _can_ be imported into client-side code
 * - **Only** variables that begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) (which defaults to `PUBLIC_`) are included
 * 
 * > [!NOTE] In `dev`, `$env/dynamic` includes environment variables from `.env`. In `prod`, this behavior will depend on your adapter.
 * 
 * > [!NOTE] To get correct types, environment variables referenced in your code should be declared (for example in an `.env` file), even if they don't have a value until the app is deployed:
 * >
 * > ```env
 * > MY_FEATURE_FLAG=
 * > ```
 * >
 * > You can override `.env` values from the command line like so:
 * >
 * > ```sh
 * > MY_FEATURE_FLAG="enabled" npm run dev
 * > ```
 * 
 * For example, given the following runtime environment:
 * 
 * ```env
 * ENVIRONMENT=production
 * PUBLIC_BASE_URL=http://example.com
 * ```
 * 
 * With the default `publicPrefix` and `privatePrefix`:
 * 
 * ```ts
 * import { env } from '$env/dynamic/public';
 * console.log(env.ENVIRONMENT); // => undefined, not public
 * console.log(env.PUBLIC_BASE_URL); // => "http://example.com"
 * ```
 * 
 * ```
 * 
 * ```
 */
declare module '$env/dynamic/public' {
	export const env: {
		[key: `PUBLIC_${string}`]: string | undefined;
	}
}
