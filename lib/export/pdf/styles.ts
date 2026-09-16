// Estilos compartidos de los documentos PDF (PARTE 5 del pedido): A4,
// tipografía legible, márgenes correctos, sin nada de interfaz web (sin
// sidebar, sin botones, sin colores excesivos) — pensado para imprimir y
// archivar.

import { StyleSheet } from '@react-pdf/renderer';

export const INK = '#2A2521';
export const INK_SOFT = '#6B6157';
export const INK_FAINT = '#928A7E';
export const BORDER = '#DCD3C6';
export const HEADER_FILL = '#F4EEE4';
export const ACCENT = '#B8563B';

export const pdfStyles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingBottom: 56,
    paddingHorizontal: 44,
    fontSize: 10,
    color: INK,
    fontFamily: 'Helvetica',
  },
  brandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  brand: {
    fontSize: 12,
    fontWeight: 700,
    color: ACCENT,
  },
  generatedAt: {
    fontSize: 8,
    color: INK_FAINT,
    textAlign: 'right',
  },
  professionalLine: {
    fontSize: 9,
    color: INK_SOFT,
    marginBottom: 2,
  },
  professionalSubLine: {
    fontSize: 8,
    color: INK_FAINT,
    marginBottom: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
    marginBottom: 2,
    marginTop: 6,
  },
  subtitle: {
    fontSize: 10,
    color: INK_SOFT,
    marginBottom: 14,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    marginBottom: 12,
  },
  sectionHeading: {
    fontSize: 12,
    fontWeight: 700,
    marginTop: 16,
    marginBottom: 6,
    color: INK,
  },
  fieldRow: {
    flexDirection: 'row',
    marginBottom: 3,
  },
  fieldLabel: {
    width: 140,
    fontSize: 9,
    color: INK_SOFT,
    fontWeight: 700,
  },
  fieldValue: {
    flex: 1,
    fontSize: 9,
    color: INK,
  },
  paragraphLabel: {
    fontSize: 9,
    fontWeight: 700,
    marginTop: 8,
    marginBottom: 2,
  },
  paragraphValue: {
    fontSize: 9,
    lineHeight: 1.4,
  },
  emptyNote: {
    fontSize: 9,
    color: INK_FAINT,
    fontStyle: 'italic',
  },
  table: {
    marginTop: 4,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: HEADER_FILL,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: BORDER,
    paddingVertical: 4,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderColor: BORDER,
    paddingVertical: 4,
  },
  tableCellHeader: {
    fontSize: 8,
    fontWeight: 700,
    paddingHorizontal: 4,
  },
  tableCell: {
    fontSize: 8,
    paddingHorizontal: 4,
  },
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 44,
    right: 44,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 8,
    color: INK_FAINT,
    borderTopWidth: 0.5,
    borderTopColor: BORDER,
    paddingTop: 6,
  },
});
