import { Extension } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    indent: {
      increaseIndent: () => ReturnType;
      decreaseIndent: () => ReturnType;
      setLineSpacing: (value: string) => ReturnType;
      unsetLineSpacing: () => ReturnType;
      setParaSpacing: (before: string, after: string) => ReturnType;
    };
  }
}

export const CLEANUP_RULES: Record<string, { before: string; after: string }> = {
  heading_1: { before: "24pt", after: "12pt" },
  heading_2: { before: "16pt", after: "8pt" },
  heading_3: { before: "12pt", after: "6pt" },
  heading_4: { before: "8pt",  after: "4pt" },
  heading_5: { before: "8pt",  after: "4pt" },
  heading_6: { before: "8pt",  after: "4pt" },
  paragraph:  { before: "0pt", after: "8pt" },
};

const BLOCK_TYPES = ["paragraph", "heading"];

export const Indent = Extension.create({
  name: "indent",

  addGlobalAttributes() {
    return [
      {
        types: BLOCK_TYPES,
        attributes: {
          indent: {
            default: 0,
            parseHTML: (el) => {
              const v = el.getAttribute("data-indent");
              return v ? parseInt(v, 10) : 0;
            },
            renderHTML: (attrs) => {
              if (!attrs.indent) return {};
              return {
                "data-indent": attrs.indent,
                style: `padding-left: ${attrs.indent * 2}rem`,
              };
            },
          },
          lineSpacing: {
            default: null,
            parseHTML: (el) => el.getAttribute("data-line-spacing") ?? null,
            renderHTML: (attrs) => {
              if (!attrs.lineSpacing) return {};
              return {
                "data-line-spacing": attrs.lineSpacing,
                style: `line-height: ${attrs.lineSpacing}`,
              };
            },
          },
          spacingBefore: {
            default: null,
            parseHTML: (el) => el.getAttribute("data-spacing-before") ?? null,
            renderHTML: (attrs) => {
              if (!attrs.spacingBefore) return {};
              return {
                "data-spacing-before": attrs.spacingBefore,
                style: `margin-top: ${attrs.spacingBefore}`,
              };
            },
          },
          spacingAfter: {
            default: null,
            parseHTML: (el) => el.getAttribute("data-spacing-after") ?? null,
            renderHTML: (attrs) => {
              if (!attrs.spacingAfter) return {};
              return {
                "data-spacing-after": attrs.spacingAfter,
                style: `margin-bottom: ${attrs.spacingAfter}`,
              };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      increaseIndent:
        () =>
        ({ tr, state, dispatch }) => {
          const { from, to } = state.selection;
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (BLOCK_TYPES.includes(node.type.name)) {
              const current = node.attrs.indent ?? 0;
              if (current < 8) {
                tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: current + 1 });
              }
            }
          });
          if (dispatch) dispatch(tr);
          return true;
        },
      decreaseIndent:
        () =>
        ({ tr, state, dispatch }) => {
          const { from, to } = state.selection;
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (BLOCK_TYPES.includes(node.type.name)) {
              const current = node.attrs.indent ?? 0;
              if (current > 0) {
                tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: current - 1 });
              }
            }
          });
          if (dispatch) dispatch(tr);
          return true;
        },
      setLineSpacing:
        (value: string) =>
        ({ tr, state, dispatch }) => {
          const { from, to } = state.selection;
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (BLOCK_TYPES.includes(node.type.name)) {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, lineSpacing: value });
            }
          });
          if (dispatch) dispatch(tr);
          return true;
        },
      unsetLineSpacing:
        () =>
        ({ tr, state, dispatch }) => {
          const { from, to } = state.selection;
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (BLOCK_TYPES.includes(node.type.name)) {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, lineSpacing: null });
            }
          });
          if (dispatch) dispatch(tr);
          return true;
        },
      setParaSpacing:
        (before: string, after: string) =>
        ({ tr, state, dispatch }) => {
          const { from, to } = state.selection;
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (BLOCK_TYPES.includes(node.type.name)) {
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                spacingBefore: before || null,
                spacingAfter: after || null,
              });
            }
          });
          if (dispatch) dispatch(tr);
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        if (this.editor.isActive("listItem")) {
          return this.editor.commands.sinkListItem("listItem");
        }
        if (this.editor.isActive("taskItem")) {
          return false;
        }
        return this.editor.commands.increaseIndent();
      },
      "Shift-Tab": () => {
        if (this.editor.isActive("listItem")) {
          return this.editor.commands.liftListItem("listItem");
        }
        if (this.editor.isActive("taskItem")) {
          return false;
        }
        return this.editor.commands.decreaseIndent();
      },
    };
  },
});
