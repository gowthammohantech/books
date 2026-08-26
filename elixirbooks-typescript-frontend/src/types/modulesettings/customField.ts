export interface CustomFieldTypeShape {
    id: string;
    name: string;
    slug: string;
    status: string;
}

export interface CustomFieldOption {
    label: string;
    value: string;
}

/** API row shape: the custom-field list/module endpoints spread the DB row
 *  and graft `dataType` = the populated FieldType relation. */
export interface CustomFieldShape {
    id?: string;
    moduleId: string;
    labelName: string;
    fieldSlug: string;
    dataType: CustomFieldTypeShape;
    helpText?: string;
    isMandatory: boolean;
    showInTable: boolean;
    options?: CustomFieldOption[];
    status?: string;
    placement?: 'document' | 'lineItem';
    createdAt?: string;
}

/** Form/request state — create/update payloads send `dataType` as the
 *  FieldType id, not the populated object. */
export type CustomFieldFormState = Omit<CustomFieldShape, 'dataType' | 'createdAt'> & {
    dataType: string;
};
