import { redirect } from "next/navigation";

// Deprecated route (old flat-category flow). Everything now lives under
// /project/[id] -- send anyone who lands here back to the project list.
export default function DeprecatedCategoryPage() {
  redirect("/");
}
