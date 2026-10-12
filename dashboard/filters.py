def project(text):
    result = ''
    if (text != 'all'):
        result = ' for "' + text + '"'
    return result


def folder(text):
    result = ''
    if (text != 'all'):
        result = ' in "' + text + '"'
    return result
