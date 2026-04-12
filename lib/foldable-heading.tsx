"use client";

import Heading from "@tiptap/extension-heading";
import {
  ReactNodeViewRenderer,
  NodeViewWrapper,
  NodeViewContent,
} from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

function HeadingNodeView({ node, updateAttributes }: NodeViewProps) {
  const level = node.attrs.level as number;
  const folded = node.attrs.folded as boolean;
  const Tag = `h${level}` as React.ElementType;

  return (
    <NodeViewWrapper as={Tag}>
      <NodeViewContent as={"span" as "div"} />
      <button
        contentEditable={false}
        onClick={() => updateAttributes({ folded: !folded })}
        className="inline-flex items-center ml-2 text-[0.55em] font-normal text-zinc-300 hover:text-zinc-500 transition-colors select-none cursor-pointer align-middle"
        title={folded ? "Expand section" : "Collapse section"}
      >
        {folded ? "▶" : "▼"}
      </button>
    </NodeViewWrapper>
  );
}

const foldPluginKey = new PluginKey("foldHeadings");

// When a heading is folded, hide all following nodes until a heading at the
// same or higher level (lower number). Sub-headings inside the fold are also
// hidden by this — they only surface once the parent is unfolded.
const foldPlugin = new Plugin({
  key: foldPluginKey,
  props: {
    decorations(state) {
      const decorations: Decoration[] = [];
      let foldedLevel: number | null = null;

      state.doc.forEach((node, pos) => {
        if (node.type.name === "heading") {
          const level = node.attrs.level as number;
          const nodeFolded = node.attrs.folded as boolean;

          if (foldedLevel !== null && level <= foldedLevel) {
            // This heading closes the current fold
            foldedLevel = null;
            // It may start its own fold
            if (nodeFolded) foldedLevel = level;
          } else if (foldedLevel !== null) {
            // Sub-heading inside an active fold — hide it
            decorations.push(
              Decoration.node(pos, pos + node.nodeSize, { style: "display:none" })
            );
          } else if (nodeFolded) {
            foldedLevel = level;
          }
        } else if (foldedLevel !== null) {
          decorations.push(
            Decoration.node(pos, pos + node.nodeSize, { style: "display:none" })
          );
        }
      });

      return DecorationSet.create(state.doc, decorations);
    },
  },
});

export const FoldableHeading = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      folded: {
        default: false,
        parseHTML: (el) => el.getAttribute("data-folded") === "true",
        renderHTML: (attrs) => (attrs.folded ? { "data-folded": "true" } : {}),
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(HeadingNodeView);
  },
  addProseMirrorPlugins() {
    return [foldPlugin];
  },
});
