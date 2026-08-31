import { useQuery } from '@tanstack/react-query';
import { fetchCustomFieldsByModule, fetchModuleHierarchy } from '@api/customFieldTypeApi';
import type { LineCustomField } from '../lib/lineCustomFields';

export const LINE_ITEM_FIELD_MODULES = ['invoices', 'purchases', 'purchase-orders', 'quotations'] as const;
export type LineItemFieldModule = (typeof LINE_ITEM_FIELD_MODULES)[number];

/** Active lineItem-placed custom fields for a document module. Pages without
 *  their own custom-field settings inherit a parent module's fields:
 *  credit notes / delivery challans / recurring schedules -> 'invoices',
 *  debit notes -> 'purchases'. */
export function useLineItemCustomFields(
    token: string | null | undefined,
    moduleSlug: LineItemFieldModule | null,
): { fields: LineCustomField[]; isLoading: boolean } {
    const { data: hierarchy, isLoading: isModulesLoading } = useQuery({
        queryKey: ['moduleHierarchy'],
        queryFn: () => fetchModuleHierarchy(token!),
        refetchOnMount: false,
        enabled: !!token,
        staleTime: 1000 * 60 * 60,
    });

    let moduleId: string | null = null;
    if (hierarchy?.data && moduleSlug) {
        for (const mod of hierarchy.data) {
            if (mod.moduleSlug === moduleSlug) { moduleId = mod.id; break; }
            const child = mod.children?.find((c) => c.moduleSlug === moduleSlug);
            if (child) { moduleId = child.id; break; }
        }
    }

    const { data: fieldsResponse, isLoading: isFieldsLoading } = useQuery({
        queryKey: ['lineItemCustomFields', moduleId],
        queryFn: () => fetchCustomFieldsByModule(token!, moduleId!, { limit: 100 }),
        refetchOnMount: false,
        enabled: !!token && !!moduleId,
    });

    const fields: LineCustomField[] = (fieldsResponse?.data?.fields ?? [])
        .filter((f) => f.placement === 'lineItem' && (f.status ?? 'Active') === 'Active')
        .map((f) => ({
            id: f.id ?? '',
            labelName: f.labelName,
            fieldSlug: f.fieldSlug,
            isMandatory: f.isMandatory,
            placement: f.placement,
            status: f.status,
            options: f.options,
            dataType: f.dataType,
            createdAt: f.createdAt,
        }));

    return { fields, isLoading: isModulesLoading || isFieldsLoading };
}
