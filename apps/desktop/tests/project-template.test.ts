import { describe, expect, test } from "vite-plus/test";
import {
  folderTemplates,
  inFolders,
  isProjectTemplate,
  templateFolder,
} from "../src/lib/project-template";

describe("templateFolder", () => {
  test("reads Templater's and the core plugin's folder, trimmed of slashes", () => {
    const templater = JSON.stringify({ templates_folder: "/Practical/🖨 Template/" });
    expect(templateFolder(templater, "templates_folder")).toBe("Practical/🖨 Template");
    expect(templateFolder(JSON.stringify({ folder: "Templates" }), "folder")).toBe("Templates");
  });

  test("none when unset, the vault root, or not JSON", () => {
    expect(templateFolder("{}", "templates_folder")).toBeNull();
    expect(
      templateFolder(JSON.stringify({ templates_folder: "/" }), "templates_folder"),
    ).toBeNull();
    expect(templateFolder(JSON.stringify({ folder: "  " }), "folder")).toBeNull();
    expect(templateFolder(JSON.stringify({ folder: 3 }), "folder")).toBeNull();
    expect(templateFolder("null", "folder")).toBeNull();
    expect(templateFolder("not json", "folder")).toBeNull();
  });
});

describe("inFolders", () => {
  const folders = ["Practical/🖨 Template", "Templates"];

  test("a path in a folder, at any depth", () => {
    expect(inFolders("Practical/🖨 Template/Project template.md", folders)).toBe(true);
    expect(inFolders("Templates/old/Trip.md", folders)).toBe(true);
  });

  test("not a sibling that only starts with the folder's name", () => {
    expect(inFolders("Templates and more/Trip.md", folders)).toBe(false);
    expect(inFolders("Practical/Project.md", folders)).toBe(false);
    expect(inFolders("Trip.md", [])).toBe(false);
  });

  test("matches whichever Unicode form the file system spells the name in", () => {
    expect(inFolders("Cafe\u0301/Trip.md", ["Caf\u00e9"])).toBe(true);
  });
});

describe("folderTemplates", () => {
  test("reads Templater's folder → template pairs", () => {
    const settings = JSON.stringify({
      folder_templates: [
        { folder: "/1. Project/", template: "Practical/🖨 Template/Project template.md" },
        { folder: "", template: "" },
        { folder: "x" },
      ],
    });
    expect(folderTemplates(settings)).toEqual([
      { folder: "1. Project", template: "Practical/🖨 Template/Project template.md" },
    ]);
  });

  test("nothing from settings without pairs or that aren't JSON", () => {
    expect(folderTemplates("{}")).toEqual([]);
    expect(folderTemplates("not json")).toEqual([]);
  });
});

describe("isProjectTemplate", () => {
  test("a template whose Type is Project", () => {
    expect(isProjectTemplate("---\nType: Project\nStatus: Done\n---\n# Tasks\n")).toBe(true);
    expect(isProjectTemplate("---\nType: People\n---\n")).toBe(false);
    expect(isProjectTemplate("# Tasks\n")).toBe(false);
  });
});
