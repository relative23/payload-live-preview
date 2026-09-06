<script lang="ts">
  export let data;
</script>

<iframe
  id="preview"
  data-testid="preview-frame"
  title="Preview"
  src={data.src}
  style="width: 800px; height: 600px; border: 0; display: block"
></iframe>
