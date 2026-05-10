/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** Config Folder - Folder scanned for sing-box JSON configs. Top-level *.json files and an optional 'profiles/' subfolder are listed. */
  "configFolder": string,
  /** sing-box Binary - Path to the sing-box executable. Leave blank to auto-detect from /opt/homebrew/bin, /usr/local/bin, /usr/bin. */
  "singBoxBinary": string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `menu-bar` command */
  export type MenuBar = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `menu-bar` command */
  export type MenuBar = {}
}

