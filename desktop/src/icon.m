#import <Cocoa/Cocoa.h>

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc < 3) return 1;
        NSImage *source = [[NSImage alloc] initWithContentsOfFile:[NSString stringWithUTF8String:argv[1]]];
        if (!source || source.size.width <= 0 || source.size.height <= 0) return 2;
        NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:1024 pixelsHigh:1024 bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSCalibratedRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
        [NSGraphicsContext saveGraphicsState];
        NSGraphicsContext *context = [NSGraphicsContext graphicsContextWithBitmapImageRep:rep];
        [NSGraphicsContext setCurrentContext:context];
        context.imageInterpolation = NSImageInterpolationHigh;
        [[NSColor clearColor] setFill]; NSRectFillUsingOperation(NSMakeRect(0, 0, 1024, 1024), NSCompositingOperationCopy);
        CGFloat scale = 880.0 / MAX(source.size.width, source.size.height);
        NSSize size = NSMakeSize(source.size.width * scale, source.size.height * scale);
        [source drawInRect:NSMakeRect((1024-size.width)/2, (1024-size.height)/2, size.width, size.height) fromRect:NSZeroRect operation:NSCompositingOperationSourceOver fraction:1];
        [NSGraphicsContext restoreGraphicsState];
        NSData *data = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
        return [data writeToFile:[NSString stringWithUTF8String:argv[2]] atomically:YES] ? 0 : 3;
    }
}
