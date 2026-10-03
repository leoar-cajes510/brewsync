import { api } from './api';
import type { DocumentDto } from '../types/api';

export const listDocuments = () => api.get<DocumentDto[]>('/documents');
export const getDocument = (id: string) => api.get<DocumentDto>(`/documents/${id}`);

/** Print or reprint: same number and content; the server increments print_count. */
export const printDocument = (id: string) => api.post<DocumentDto>(`/documents/${id}/reprint`);
