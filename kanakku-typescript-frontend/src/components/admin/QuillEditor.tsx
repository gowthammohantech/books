import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import Quill from 'quill';
import 'quill/dist/quill.snow.css';

interface QuillEditorProps {
    value?: string;
    onChange?: (content: string) => void;
    height?: string;
}

export interface QuillEditorRef {
    insertText: (text: string) => void;
    getQuillInstance: () => Quill | null;
}

const QuillEditor = forwardRef<QuillEditorRef, QuillEditorProps>(({ value = '', onChange, height = '200px' }, ref) => {
    const editorRef = useRef<HTMLDivElement>(null);
    const quillInstance = useRef<Quill | null>(null);

    useImperativeHandle(ref, () => ({
        insertText: (text: string) => {
            if (quillInstance.current) {
                const selection = quillInstance.current.getSelection();
                const cursorPosition = selection ? selection.index : quillInstance.current.getLength();
                quillInstance.current.insertText(cursorPosition, text);
                quillInstance.current.setSelection(cursorPosition + text.length, 0);
            }
        },
        getQuillInstance: () => quillInstance.current,
    }));

    useEffect(() => {
        if (editorRef.current && !quillInstance.current) {
            quillInstance.current = new Quill(editorRef.current, {
                theme: 'snow',
                modules: {
                    toolbar: [
                        [{ header: [1, 2, 3, false] }],
                        ['bold', 'italic', 'underline', 'strike'],
                        [{ list: 'ordered' }, { list: 'bullet' }],
                        [{ color: [] }, { background: [] }],
                        ['link', 'image'],
                        ['clean'],
                    ],
                },
            });

            // Listen for changes
            quillInstance.current.on('text-change', () => {
                onChange?.(quillInstance.current!.root.innerHTML);
            });
        }
    }, [onChange]);

    // Sync external value → editor content
    useEffect(() => {
        if (quillInstance.current && value !== quillInstance.current.root.innerHTML) {
            quillInstance.current.root.innerHTML = value || '';
        }
    }, [value]);

    return <div ref={editorRef} style={{ height, minHeight: '200px' }} />;
});

QuillEditor.displayName = 'QuillEditor';

export default QuillEditor;
