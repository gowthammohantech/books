import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import { Bold, Italic, Underline as UnderlineIcon, List, ListOrdered, AlignLeft, AlignCenter, AlignRight, Heading2, Heading3, CodeSquare } from 'lucide-react';
import type { Editor } from '@tiptap/core';
import { useEffect } from 'react';

const Toolbar = ({ editor }: { editor: Editor | null }) => {
  if (!editor) {
    return null;
  }

  return (
    <div className="toolbar">
      <button type='button' onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={editor.isActive('heading', { level: 2 }) ? 'is-active' : ''}>
        <Heading2 className="h-5 w-5" />
      </button>
      <button type='button' onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} className={editor.isActive('heading', { level: 3 }) ? 'is-active' : ''}>
        <Heading3 className="h-5 w-5" />
      </button>
      <button type='button' onClick={() => editor.chain().focus().toggleBold().run()} className={editor.isActive('bold') ? 'is-active' : ''}>
        <Bold className="h-5 w-5" />
      </button>
      <button type='button' onClick={() => editor.chain().focus().toggleItalic().run()} className={editor.isActive('italic') ? 'is-active' : ''}>
        <Italic className="h-5 w-5" />
      </button>
      <button type='button' onClick={() => editor.chain().focus().toggleUnderline().run()} className={editor.isActive('underline') ? 'is-active' : ''}>
        <UnderlineIcon className="h-5 w-5" />
      </button>
      <button type='button' onClick={() => editor.chain().focus().toggleCodeBlock().run()} className={editor.isActive('codeBlock') ? 'is-active' : ''}>
        <CodeSquare className="h-5 w-5" />
      </button>
      <button type='button' onClick={() => editor.chain().focus().toggleBulletList().run()} className={editor.isActive('bulletList') ? 'is-active' : ''}>
        <List className="h-5 w-5" />
      </button>
      <button type='button' onClick={() => editor.chain().focus().toggleOrderedList().run()} className={editor.isActive('orderedList') ? 'is-active' : ''}>
        <ListOrdered className="h-5 w-5" />
      </button>
      <button type='button' onClick={() => editor.chain().focus().setTextAlign('left').run()} className={editor.isActive({ textAlign: 'left' }) ? 'is-active' : ''}>
        <AlignLeft className="h-5 w-5" />
      </button>
      <button type='button' onClick={() => editor.chain().focus().setTextAlign('center').run()} className={editor.isActive({ textAlign: 'center' }) ? 'is-active' : ''}>
        <AlignCenter className="h-5 w-5" />
      </button>
      <button type='button' onClick={() => editor.chain().focus().setTextAlign('right').run()} className={editor.isActive({ textAlign: 'right' }) ? 'is-active' : ''}>
        <AlignRight className="h-5 w-5" />
      </button>
    </div>
  );
};

// The Main Editor Component
interface TiptapEditorProps {
  value: string;
  onChange: (value: string) => void;
  onEditorReady?: (editor: any) => void;
}

export const TiptapEditor = ({ value, onChange, onEditorReady }: TiptapEditorProps) => {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class: 'prose bg-white text-gray-950 max-w-none focus:outline-none p-4',
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });
  useEffect(() => {
    if (editor && onEditorReady) {
      onEditorReady(editor);
    }
  }, [editor, onEditorReady]);

  return (
    <div className="editor-container">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
};