This is for in the future when I want to compress more images or anyone else for that matter.
# Lossless

### https://squoosh.app/
good at reducing the pallet, a first step for images that have a limited number of colors, bad at actually compressing things though, for all formats except WEBP and PNG.

## PNGs:
Good ratios, though not as good as other options, though better compatibility.
### oxipng
*(you can also use through squoosh with the same results)*
Seems to be the best of all of the options, not sure if it's all you would need, but it did shrink pngs further than the other two tools afterwards.
```bash
oxipng -o max --strip all --alpha <filename here>
```
`all` may be replaced with `safe` if you want to be a bit safer.

### pngcrush
Good, but should be ran before optipng, but isn't as good as it, use in tandom.
### optipng
The second best tool to really shrink pngs to be as small as they can be.

## WEBP
It's better than png, though I have a feeling more could be done to compress these
### cwebp
So far this seems to be the best way to compress WEBP images with a command that kinda looks like this one:
```bash
cwebp -lossless -z 9 in.webp -o out.webp
```
While for all other formats squoosh is not recommended, for WEBP it'll be identical due to cWEBP using the same libary as squoosh.

## AVIF
As far as I can tell, this format just sucks at its job, at least for lossless images

## JPEGXL
Really good at compression size, though it's not supported anywhere outside of Safari as of now.
### cjxl
This command should do the trick for compressing:
```bash
cjxl input.png output.jxl -q 100 -e 10
```

# Vector

## SVGs:
### https://svgomg.net/
Great tool! If anyone knows how to squish them further, let me know! Some manual work may go a long way to help shrink SVGs, though I'm not doing that right now lol.

I may look into other formats soon as well, though these are the main two I'm currently using.
