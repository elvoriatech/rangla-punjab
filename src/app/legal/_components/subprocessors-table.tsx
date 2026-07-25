import { SUBPROCESSORS } from "@/content/legal/subprocessors";

/** Data-driven table so the DPA copy stays static while the vendor list
 *  can change with an ordinary code review. */
export function SubprocessorsTable(): React.ReactElement {
  return (
    <table className="mt-6 w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-brand-green/30 text-left">
          <th scope="col" className="py-2 pr-4 font-medium">
            Name
          </th>
          <th scope="col" className="py-2 pr-4 font-medium">
            Purpose
          </th>
          <th scope="col" className="py-2 pr-4 font-medium">
            Region
          </th>
          <th scope="col" className="py-2 pr-4 font-medium">
            DPA
          </th>
        </tr>
      </thead>
      <tbody>
        {SUBPROCESSORS.map((s) => (
          <tr key={s.name} className="border-b border-brand-green/10 align-top">
            <td className="py-2 pr-4 font-medium">{s.name}</td>
            <td className="py-2 pr-4 text-brand-green/80">{s.purpose}</td>
            <td className="py-2 pr-4">{s.region}</td>
            <td className="py-2 pr-4">
              <a
                href={s.dpaUrl}
                className="underline hover:text-brand-gold"
                target="_blank"
                rel="noreferrer"
              >
                DPA ↗
              </a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
