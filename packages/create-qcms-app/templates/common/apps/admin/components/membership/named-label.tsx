/** A control whose visible word is short and whose accessible name says whom it acts on. */
export function NamedLabel({ visible, name }: { readonly visible: string; readonly name: string }) {
  return (
    <>
      <span aria-hidden="true">{visible}</span>
      <span className="qcms-visually-hidden">{name}</span>
    </>
  );
}
