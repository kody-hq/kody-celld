import type { UserCell } from '../cells/user-cell.ts'
import { KodyError } from '../lib/errors.ts'

type SecretApprovalCell = Pick<UserCell, 'packageGet' | 'secretList' | 'secretUsageGrant'>

export async function secretPackageApprovalDetails(
	userCell: SecretApprovalCell,
	input: { name: string; packageName: string },
) {
	const namedSecrets = (await userCell.secretList()).filter((secret) => secret.name === input.name)
	const secret = namedSecrets.find((item) => item.scope === 'user')
	if (!secret && namedSecrets.length === 0) {
		throw new KodyError('secret_not_found', `Unknown secret "${input.name}".`, { status: 404 })
	}
	if (!secret) throw new KodyError('invalid_secret_scope', 'Package access grants only apply to user-scope secrets.')
	if (!(await userCell.packageGet(input.packageName))) {
		throw new KodyError('package_not_found', `Package "${input.packageName}" is not installed.`, { status: 404 })
	}
	return { secret }
}

export async function approveSecretPackage(userCell: SecretApprovalCell, input: { name: string; packageName: string }) {
	await secretPackageApprovalDetails(userCell, input)
	return userCell.secretUsageGrant(input)
}
