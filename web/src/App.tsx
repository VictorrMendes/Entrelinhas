import { useState } from 'react';
import { Library } from './Library';
import { Reader } from './Reader';
import type { Book } from './store';

export function App() {
  const [book, setBook] = useState<Book | null>(null);
  return book ? <Reader book={book} onClose={() => setBook(null)} /> : <Library onOpen={setBook} />;
}
