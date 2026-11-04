/** @jsxImportSource @emotion/react */
import { PackageFilesExplorer } from '../components/package-files-explorer.tsx'
import { type AppLoaderData } from '#universal/loader-data.ts'
type Data = Extract<
	AppLoaderData,
	{
		page: 'accountPackageFiles'
	}
>
/**
 * `/account/packages/:name/files/*` — kody's files explorer over a saved
 * package (kody: client/routes/package-files.tsx). The data arrives with the
 * server render instead of through kody's client-router loader.
 */
export function PackageFiles(props: { data: Data; pathname: string }) {
	return <PackageFilesExplorer data={props.data.files} />
}
