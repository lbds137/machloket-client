/** The dev server calls itself Machlakot, so an install from it can't pass for the real app. */
export const APP_NAME = import.meta.env.DEV ? "Machlakot" : "Machloket";
