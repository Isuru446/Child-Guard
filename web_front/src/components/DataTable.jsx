import './DataTable.css';

export default function DataTable({
  columns = [],
  data = [],
  rowKey = 'id',
  caption = 'Data table',
  emptyMessage = 'No records found.',
  loading = false,
  minWidth = 900,
  className = '',
}) {
  const getRowKey = (row) =>
    typeof rowKey === 'function'
      ? rowKey(row)
      : row[rowKey];

  return (
    <div className={`cg-data-table ${className}`}>
      <div
        className="cg-data-table__scroll"
        role="region"
        aria-label={caption}
        tabIndex={0}
      >
        <table
          className="cg-data-table__table"
          style={{ minWidth }}
          aria-busy={loading}
        >
          <caption className="cg-data-table__caption">
            {caption}
          </caption>
          <colgroup>
            {columns.map(column=><col key={column.key} style={{width:column.width??(column.key==='actions'?'1%':undefined)}}/>)}
          </colgroup>

          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={[column.key==='actions'?'cg-data-table__actions':'',column.headerClassName].filter(Boolean).join(' ')}
                  style={{
                    textAlign: column.align || 'left',
                  }}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {loading && data.length === 0 ? (
              <tr>
                <td
                  colSpan={Math.max(columns.length, 1)}
                  className="cg-data-table__empty"
                  role="status"
                >
                  Loading...
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td
                  colSpan={Math.max(columns.length, 1)}
                  className="cg-data-table__empty"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              data.map((row, index) => (
                <tr key={getRowKey(row)}>
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={[column.key==='actions'?'cg-data-table__actions':'',column.className].filter(Boolean).join(' ')}
                      style={{
                        textAlign: column.align || 'left',
                      }}
                    >
                      {column.render
                        ? column.render(row, index)
                        : row[column.key] ?? '—'}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
