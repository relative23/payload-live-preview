/**
 * Vue owns the component and its visitor state while a child effectScope owns the installed
 * composable. Stop and restart change that native scope, not a replacement session implementation
 * or an application fetch scheduler.
 */
import {
  computed,
  defineComponent,
  effectScope,
  h,
  onMounted,
  onScopeDispose,
  onUnmounted,
  ref,
  shallowRef,
  watchEffect,
} from 'vue';
import { useLivePreviewDocument } from 'payload-live-preview/vue';
import {
  beginOwner,
  commitSnapshot,
  connection,
  initialData,
  installControls,
  ledger,
  observeSnapshot,
  ownerCleanup,
  ownerSetup,
} from './ledger.mjs';

export const App = defineComponent({
  props: ['admin', 'document', 'initialData'],
  setup(props) {
    const count = ref(0);
    const generation = ref(1);
    const stopped = ref(false);
    let scope;
    let target;
    let removeControls;
    let owner;
    const publicSnapshot = (value) => ({
      data: value.data.value,
      revision: value.revision.value,
      status: value.status.value,
      isLoading: value.isLoading.value,
      error: value.error.value,
    });
    const start = (nextGeneration = generation.value) => {
      const ownSeed = props.initialData ?? initialData(props.document);
      owner = beginOwner('vue', props.document, nextGeneration, ownSeed);
      const currentOwner = owner;
      scope = effectScope();
      const result = scope.run(() => {
        const value = useLivePreviewDocument({
          initialData: ownSeed,
          ...connection(props.admin, target, currentOwner),
        });
        observeSnapshot(currentOwner, publicSnapshot(value), 'initial');
        onScopeDispose(() => ownerCleanup(currentOwner));
        ownerSetup(currentOwner);
        return value;
      });
      if (!result) throw new Error('The native effect scope was inactive');
      if (typeof window !== 'undefined') ledger().scopeStarts += 1;
      return result;
    };
    const session = shallowRef(start());
    const stop = () => {
      if (scope) {
        scope.stop();
        scope = undefined;
        ledger().scopeStops += 1;
      }
      stopped.value = true;
    };
    const restart = () => {
      stop();
      session.value = start(generation.value + 1);
      generation.value += 1;
      stopped.value = false;
    };
    const data = computed(() => session.value.data.value);
    watchEffect(() => {
      const snapshot = publicSnapshot(session.value);
      observeSnapshot(owner, snapshot, 'commit');
      commitSnapshot(owner, snapshot);
    });
    onMounted(() => {
      ledger().ready = true;
      ledger().document = props.document;
      removeControls = installControls(props.admin, (window) => {
        target = window;
        restart();
      });
    });
    onUnmounted(() => {
      removeControls?.();
      stop();
    });
    return () =>
      h('div', null, [
        h('output', { 'data-testid': 'scope' }, stopped.value ? 'stopped' : 'active'),
        h('output', { 'data-testid': 'generation' }, String(generation.value)),
        h('button', { 'data-testid': 'stop-preview', onClick: stop }, 'Stop effect scope'),
        h(
          'button',
          { 'data-testid': 'restart-preview', onClick: restart },
          'Start a new effect scope',
        ),
        h('article', null, [
          h('h1', { 'data-testid': 'title' }, data.value.title),
          h('p', { 'data-testid': 'subtitle' }, data.value.subtitle),
          h('p', { 'data-testid': 'status' }, session.value.status.value),
          h('p', { 'data-testid': 'revision' }, String(session.value.revision.value)),
          h(
            'p',
            { 'data-testid': 'author' },
            typeof data.value.author === 'object' && data.value.author !== null
              ? (data.value.author.email ?? data.value.author.name ?? '')
              : '',
          ),
          h(
            'button',
            {
              'data-testid': 'counter',
              onClick: () => {
                count.value += 1;
              },
            },
            String(count.value),
          ),
          h('input', { 'data-testid': 'visitor', value: 'Visitor value' }),
          session.value.error.value
            ? h('p', { 'data-testid': 'error' }, session.value.error.value.message)
            : null,
        ]),
      ]);
  },
});
