/**
 * Only this internal asset is deferred to the consumer's native Astro compiler.
 * Its generated component is opaque to the peer-free package build; native
 * template checks validate the implementation without a wildcard declaration.
 */
declare const FragmentBridge: object;
export default FragmentBridge;
